#!/bin/bash
# Install (or refresh) the launchd agent that runs draftsync.py whenever the
# watched folder changes. Re-run this any time you add a new top-level
# sub-folder to the watch directory, or after editing the config.
#
#   ./install.sh            install / refresh
#   ./install.sh uninstall  remove the agent (uploads already made are untouched)

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
  echo "Removed $LABEL. Your ~/.snalbum-draftsync/ config, state and log are left in place."
  exit 0
}
[ "${1:-}" = "uninstall" ] && uninstall

[ -f "$CFG" ] || { echo "No config at $CFG"; echo "cp '$HERE/config.example' '$CFG' && chmod 600 '$CFG'  then edit it."; exit 1; }
chmod 600 "$CFG"

# shellcheck disable=SC1090
WATCH_DIR="$(grep -E '^WATCH_DIR=' "$CFG" | head -1 | cut -d= -f2- | sed 's/^ *//;s/ *$//')"
WATCH_DIR="${WATCH_DIR/#\~/$HOME}"
[ -d "$WATCH_DIR" ] || { echo "WATCH_DIR from config is not a directory: $WATCH_DIR"; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.snalbum-draftsync"

# WatchPaths = the root plus every sub-directory that exists right now.
WATCHPATHS="    <string>$WATCH_DIR</string>"
while IFS= read -r d; do
  WATCHPATHS+=$'\n'"    <string>$d</string>"
done < <(find "$WATCH_DIR" -type d -not -path "$WATCH_DIR")

python3 - "$TEMPLATE" "$SCRIPT" "$LOG" "$PLIST" "$WATCHPATHS" <<'PY'
import sys
tpl, script, log, out, watchpaths = sys.argv[1:6]
text = open(tpl).read()
text = (text.replace("__SCRIPT__", script)
            .replace("__LOG__", log)
            .replace("__WATCHPATHS__", watchpaths))
open(out, "w").write(text)
PY

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl enable "$DOMAIN/$LABEL"

echo "Installed $LABEL"
echo "  watching : $WATCH_DIR  (+ $(find "$WATCH_DIR" -type d -not -path "$WATCH_DIR" | wc -l | tr -d ' ') sub-folders)"
echo "  log      : $LOG"
echo "  kick now : launchctl kickstart -k $DOMAIN/$LABEL"
