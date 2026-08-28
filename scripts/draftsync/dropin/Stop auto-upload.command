#!/bin/bash
# Copy this into a folder that is auto-uploading and double-click it to stop.
# Nothing already uploaded is removed — this only stops future automatic runs.

HERE="$(cd "$(dirname "$0")" && pwd)"
REG="$HOME/.snalbum-draftsync/watched-folders.txt"
DOMAIN="gui/$(id -u)"

HASH="$(/sbin/md5 -q -s "$HERE" 2>/dev/null || md5 -q -s "$HERE")"
LABEL="com.bunjumun.snalbum-draftsync.${HASH:0:10}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

echo "Folder:  $HERE"
echo

if [ ! -f "$PLIST" ]; then
  echo "This folder was not auto-uploading. Nothing to stop."
else
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null
  rm -f "$PLIST"
  echo "Auto-upload is now OFF for this folder."
  echo "Everything already uploaded stays on the site."
fi

if [ -f "$REG" ]; then
  grep -Fxv "$HERE" "$REG" > "$REG.tmp" 2>/dev/null; mv "$REG.tmp" "$REG"
  echo
  echo "Still auto-uploading:"
  if [ -s "$REG" ]; then sed 's/^/  - /' "$REG"; else echo "  (nothing)"; fi
fi

echo
echo "Done. You can close this window."
