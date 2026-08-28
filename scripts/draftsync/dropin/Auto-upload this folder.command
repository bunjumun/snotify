#!/bin/bash
# Copy this file into any folder of audio, then double-click it once.
# From then on that folder auto-uploads to the music player whenever it
# changes — no polling, no Terminal, survives reboots.
# Re-run it after adding a brand-new sub-folder to pick that up.
# To turn it off, copy "Stop auto-upload.command" in and double-click that.

HERE="$(cd "$(dirname "$0")" && pwd)"
DRAFTSYNC="$HOME/claude/music-player/scripts/draftsync/draftsync.py"
# optional override: add a line  DRAFTSYNC=/path/to/draftsync.py  to the config
_ov="$(grep -E '^DRAFTSYNC=' "$HOME/.snalbum-draftsync/config" 2>/dev/null | head -1 | cut -d= -f2-)"
[ -n "${_ov:-}" ] && DRAFTSYNC="$_ov"
CFG="$HOME/.snalbum-draftsync/config"
LOG="$HOME/.snalbum-draftsync/draftsync.log"
REG="$HOME/.snalbum-draftsync/watched-folders.txt"
DOMAIN="gui/$(id -u)"

die() { echo; echo "!!  $1"; echo; echo "Nothing was changed. Close this window."; exit 1; }

echo "Folder:  $HERE"
echo

case "$HERE" in
  "$HOME"|"$HOME/Desktop"|"$HOME/Documents"|"$HOME/Downloads"|"/")
    die "That is a top-level folder. Copy this into the actual audio folder first." ;;
esac
[ -f "$DRAFTSYNC" ] || die "Can't find draftsync.py at: $DRAFTSYNC"
[ -f "$CFG" ]       || die "No band config at $CFG  — set that up first."
grep -q 'replace-with-your-band-password' "$CFG" && \
  die "$CFG still has the placeholder password. Put the real band password in it first."

# --- one visible upload now, so you can see it working --------------------
echo "Uploading what's in here now..."
echo
/usr/bin/python3 "$DRAFTSYNC" "$HERE" || die "Upload failed — see the messages above."
echo

# --- arm the always-on watcher for this folder ----------------------------
HASH="$(/sbin/md5 -q -s "$HERE" 2>/dev/null || md5 -q -s "$HERE")"
LABEL="com.bunjumun.snalbum-draftsync.${HASH:0:10}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.snalbum-draftsync"

WATCHPATHS="    <string>$HERE</string>"
while IFS= read -r d; do
  [ -n "$d" ] && WATCHPATHS+=$'\n'"    <string>$d</string>"
done < <(find "$HERE" -type d -not -path "$HERE" 2>/dev/null)

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>$DRAFTSYNC</string>
    <string>$HERE</string>
  </array>
  <key>WatchPaths</key>
  <array>
$WATCHPATHS
  </array>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>600</integer>
  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$LOG</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
PLISTEOF

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null
launchctl bootstrap "$DOMAIN" "$PLIST" || die "launchd refused to load the agent."
launchctl enable "$DOMAIN/$LABEL" 2>/dev/null

touch "$REG"
grep -Fxv "$HERE" "$REG" > "$REG.tmp" 2>/dev/null; mv "$REG.tmp" "$REG"
echo "$HERE" >> "$REG"

SUBS="$(find "$HERE" -type d -not -path "$HERE" 2>/dev/null | wc -l | tr -d ' ')"
echo "Auto-upload is ON for this folder (+ $SUBS sub-folders)."
echo "Anything you drop in here from now on goes up on its own,"
echo "plus a catch-up scan every 10 minutes."
echo
echo "Folders currently auto-uploading:"
sed 's/^/  - /' "$REG"
echo
echo "Log: $LOG"
echo "Done. You can close this window."
