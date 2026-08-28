#!/bin/bash
# Copy this into any folder of audio and double-click it to push that folder
# to the music player once. No watcher, no setup — just a one-off upload.
# Safe to run again: files already up are skipped by content hash.

HERE="$(cd "$(dirname "$0")" && pwd)"
DRAFTSYNC="$HOME/claude/music-player/scripts/draftsync/draftsync.py"
# optional override: add a line  DRAFTSYNC=/path/to/draftsync.py  to the config
_ov="$(grep -E '^DRAFTSYNC=' "$HOME/.snalbum-draftsync/config" 2>/dev/null | head -1 | cut -d= -f2-)"
[ -n "${_ov:-}" ] && DRAFTSYNC="$_ov"
CFG="$HOME/.snalbum-draftsync/config"

echo "Folder:  $HERE"
echo

[ -f "$DRAFTSYNC" ] || { echo "!!  Can't find draftsync.py at: $DRAFTSYNC"; exit 1; }
[ -f "$CFG" ]       || { echo "!!  No band config at $CFG — set that up first."; exit 1; }

/usr/bin/python3 "$DRAFTSYNC" "$HERE"
echo
echo "Done. You can close this window."
