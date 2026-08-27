#!/bin/bash
# OPTIONAL: wire up a launchd agent that runs draftsync.py automatically
# whenever ONE chosen folder changes. The portable way to use draftsync is just
# to run draftsync.py / double-click upload.command inside any folder — you only
# need this if you want a set-and-forget synced folder.
#
#   ./install.sh /path/to/folder   install / refresh, watching that folder
#   ./install.sh                    use WATCH_DIR from ~/.snalbum-draftsync/config
#   ./install.sh uninstall          remove the agent (uploads already made are untouched)

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/draftsync.py"
TEMPLATE="$HERE/com.bunjumun.snalbum-draftsync.plist.template"
LABEL="com.bunjumun.snalbum-draftsync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
CFG="$HOME/.snalbum-draftsync/config"
LOG="$HOME/.snalbum-draftsync/draftsync.log"
DOMAIN="gui/$(id -u)"

uninstall() {
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL. Your ~/.snalbum-draftsync/ config and log are left in place."
  exit 0
}
[ "${1:-}" = "uninstall" ] && uninstall

[ -f "$CFG" ] || { echo "No band config at $CFG"; echo "cp '$HERE/config.example' '$CFG' && chmod 600 '$CFG'  then edit BAND / BAND_PASS."; exit 1; }
chmod 600 "$CFG"

WATCH_DIR="${1:-}"
if [ -z "$WATCH_DIR" ]; then
  WATCH_DIR="$(grep -E '^WATCH_DIR=' "$CFG" | head -1 | cut -d= -f2- | sed 's/^ *//;s/ *$//')"
fi
[ -n "$WATCH_DIR" ] || { echo "Pass a folder:  ./install.sh /path/to/folder   (or set WATCH_DIR= in $CFG)"; exit 1; }
WATCH_DIR="${WATCH_DIR/#\~/$HOME}"
WATCH_DIR="$(cd "$WATCH_DIR" 2>/dev/null && pwd)" || { echo "Not a directory: $WATCH_DIR"; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.snalbum-draftsync"

# WatchPaths = the root plus every sub-directory that exists right now.
WATCHPATHS="    <string>$WATCH_DIR</string>"
while IFS= read -r d; do
  WATCHPATHS+=$'\n'"    <string>$d</string>"
done < <(find "$WATCH_DIR" -type d -not -path "$WATCH_DIR")

python3 - "$TEMPLATE" "$SCRIPT" "$LOG" "$PLIST" "$WATCHPATHS" "$WATCH_DIR" <<'PY'
import sys
tpl, script, log, out, watchpaths, watchdir = sys.argv[1:7]
text = open(tpl).read()
for k, v in (("__SCRIPT__", script), ("__LOG__", log),
             ("__WATCHPATHS__", watchpaths), ("__WATCH_DIR__", watchdir)):
    text = text.replace(k, v)
open(out, "w").write(text)
PY

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl enable "$DOMAIN/$LABEL"

subs="$(find "$WATCH_DIR" -type d -not -path "$WATCH_DIR" | wc -l | tr -d ' ')"
echo "Installed $LABEL"
echo "  watching : $WATCH_DIR  (+ $subs sub-folders)"
echo "  log      : $LOG"
echo "  run now  : launchctl kickstart -k $DOMAIN/$LABEL"
