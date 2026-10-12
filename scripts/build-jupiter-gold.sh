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
(cd "$SRC" && env -u GOOGLE_MAPS_API_KEY -u CESIUM_ION_TOKEN -u MAPILLARY_CLIENT_TOKEN \
  npx vite build --base ./ --outDir "$tmp/out" --emptyOutDir >"$tmp/build.log" 2>&1) \
  || { tail -30 "$tmp/build.log" >&2; echo "Build failed" >&2; exit 1; }

# Three icons are referenced from the site root ("/logo.svg"); under a subpath
# that 404s. Make them relative to the page.
perl -pi -e 's#(["\x27])/(logo|mic)\.svg#$1./$2.svg#g' "$tmp"/out/index.html "$tmp"/out/assets/index-*.js

# Public-site safety net. Cesium.js carries Cesium's own public default token and
# is byte-identical to the npm package, so it is the one file allowed to match.
hits="$(grep -rIlE 'AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9]{20,}|eyJhbGciOi' "$tmp/out" | grep -v '/cesium/Cesium\.js$' || true)"
[ -z "$hits" ] || { echo "Secret-looking strings in: $hits" >&2; exit 1; }

rm -rf "$DEST"
cp -R "$tmp/out" "$DEST"
printf 'Built %s from %s @ %s%s\n' "$(date -u +%Y-%m-%dT%H:%MZ)" "$SRC" "$branch/$commit" "$dirty" > "$DEST/BUILD.txt"
echo "OK: $(du -sh "$DEST" | cut -f1) in $DEST  ($branch/$commit$dirty)"
