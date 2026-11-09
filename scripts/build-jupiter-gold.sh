#!/usr/bin/env bash
# Rebuild the Jupiter Gold interactive music video (a Cesium map app that lives in
# AV TOOLS/climate-video) and drop the static build into
# interactive-music-players/jupiter-gold/. Run from the repo root; then commit.
#
# It builds whatever is checked out in the source repo and says which commit that
# was in BUILD.txt, so "latest" is stated rather than assumed.
#
# Static hosting has no /api backend, so the live-data layers (satellites, launches,
# aircraft, terrain heights) come up empty. The song and the Jupiter Gold story run.
set -euo pipefail

SRC="${JG_SRC:-$HOME/claude/AV TOOLS/climate-video}"
DEST="interactive-music-players/jupiter-gold"
[ -d "$SRC/.git" ] || { echo "No git repo at $SRC (set JG_SRC)" >&2; exit 1; }
[ -d interactive-music-players ] || { echo "Run from the music-player repo root" >&2; exit 1; }

commit="$(git -C "$SRC" rev-parse --short HEAD)"
branch="$(git -C "$SRC" branch --show-current)"
dirty=""; [ -n "$(git -C "$SRC" status --porcelain)" ] && dirty=" (uncommitted changes in the working tree)"

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
# Keys unset on purpose: the build inlines GOOGLE_MAPS_API_KEY / CESIUM_ION_TOKEN
# into the bundle if they are in the environment, and this goes on a public site.
(cd "$SRC" && env -u GOOGLE_MAPS_API_KEY -u CESIUM_ION_TOKEN -u MAPILLARY_CLIENT_TOKEN VITE_JG_PUBLIC=1 \
  npx vite build --base ./ --outDir "$tmp/out" --emptyOutDir >"$tmp/build.log" 2>&1) \
  || { tail -30 "$tmp/build.log" >&2; echo "Build failed" >&2; exit 1; }

# Three icons are referenced from the site root ("/logo.svg"); under a subpath
# that 404s. Make them relative to the page.
perl -pi -e 's#(["\x27])/(logo|mic)\.svg#$1./$2.svg#g' "$tmp"/out/index.html "$tmp"/out/assets/index-*.js

# A way back to the Interactive Music Players hub (CR-148). The app is a dead end on
# this site: it links nowhere and has no header of its own to hold a link. It goes in
# here rather than in the source app because that app also runs standalone, where
# "../" leads nowhere. A small fixed pill, no layout of its own, above the loading
# screen (z 1000) so it is there from the first paint, coloured from the app's own
# variables. Where it sits is chosen by what is free, measured by hit-testing the
# page at each width, because the app's chrome crowds the top edge:
#   >720px   in the strip above the title bar (title at top:32px).
#   <=720px  the title moves to top:20px and the action buttons to the top right, so
#            the strip above the title is 20px tall: a 16px pill fits.
#   <=520px  the title shrinks to its logo, leaving a pocket between logo and the
#            action buttons (which start 228px from the right edge): beside the logo.
#   <=374px  the pocket is gone (the buttons would reach under the pill), so it drops
#            into the gap under the action buttons (end y 48) and above the first
#            panel (starts y 70).
# On touch screens an invisible ::after widens the tap target to roughly 40px without
# growing the pill, stopping short of the panel below it in the <=374px layout.
# The guard below fails the build if the markup it hooks into ever changes, so the
# link cannot silently vanish on a rebuild.
cat > "$tmp/back-link.html" <<'EOF'
<style>
#snalbum-back{position:fixed;top:8px;left:36px;z-index:1001;padding:5px 10px;border:1px solid var(--glass-border,rgba(255,255,255,.08));border-radius:999px;background:var(--glass-bg,rgba(12,12,20,.72));-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:rgba(232,234,237,.72);font:500 11px/1 var(--font-mono,monospace);letter-spacing:.08em;text-decoration:none;touch-action:manipulation}
#snalbum-back:hover,#snalbum-back:focus-visible{color:var(--accent,#00d4ff);border-color:var(--accent-glow,rgba(0,212,255,.4))}
@media(pointer:coarse){#snalbum-back::after{content:"";position:absolute;inset:-8px -10px var(--hb,-8px)}}
@media(max-width:720px){#snalbum-back{top:2px;left:20px;padding:2px 8px;font-size:10px}}
@media(max-width:520px){#snalbum-back{top:17px;left:60px;padding:6px 9px}}
@media(max-width:374px){#snalbum-back{top:50px;left:16px;padding:3px 9px;--hb:-1px}}
</style>
<a id="snalbum-back" href="../">&larr; Players</a>
EOF
perl -0777 -pi -e 'BEGIN{local $/; open F,"<",shift or die; $s=<F>; close F} s{</body>}{$s</body>}' "$tmp/back-link.html" "$tmp"/out/index.html
[ "$(grep -c 'id="snalbum-back"' "$tmp/out/index.html")" = 1 ] \
  || { echo "Back link was not injected exactly once (does index.html still end in </body>?)" >&2; exit 1; }

# Public-site safety net. Cesium.js carries Cesium's own public default token and
# is byte-identical to the npm package, so it is the one file allowed to match.
hits="$(grep -rIlE 'AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9]{20,}|eyJhbGciOi' "$tmp/out" | grep -v '/cesium/Cesium\.js$' || true)"
[ -z "$hits" ] || { echo "Secret-looking strings in: $hits" >&2; exit 1; }

rm -rf "$DEST"
cp -R "$tmp/out" "$DEST"
printf 'Built %s from %s @ %s%s\n' "$(date -u +%Y-%m-%dT%H:%MZ)" "$SRC" "$branch/$commit" "$dirty" > "$DEST/BUILD.txt"
echo "OK: $(du -sh "$DEST" | cut -f1) in $DEST  ($branch/$commit$dirty)"
