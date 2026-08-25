#!/usr/bin/env bash
# Hash one or more repo-relative files against the live site and report matches.
# Replaces the ad hoc "curl + shasum + compare by eye" done by hand in nearly
# every ledger COMPLETED entry. Run from the repo root.
#
# Usage: scripts/verify-live.sh index.html music.html game/src/entities/Diver.js

set -euo pipefail

BASE_URL="${SNALBUM_LIVE_URL:-https://bunjumun.github.io/snotify}"

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 <repo-relative-path> [more paths...]" >&2
  exit 1
fi

fail=0
printf '%-45s %-10s %s\n' "FILE" "RESULT" "URL"
printf '%-45s %-10s %s\n' "----" "------" "---"

for path in "$@"; do
  if [ ! -f "$path" ]; then
    printf '%-45s %-10s %s\n' "$path" "NO LOCAL" "-"
    fail=1
    continue
  fi

  url="${BASE_URL%/}/${path}?cachebust=$(date +%s)"
  local_hash=$(shasum -a 256 "$path" | awk '{print $1}')
  remote_hash=$(curl -fsSL "$url" 2>/dev/null | shasum -a 256 | awk '{print $1}') || remote_hash="FETCH_FAILED"

  if [ "$remote_hash" = "FETCH_FAILED" ]; then
    printf '%-45s %-10s %s\n' "$path" "FETCH ERR" "$url"
    fail=1
  elif [ "$local_hash" = "$remote_hash" ]; then
    printf '%-45s %-10s %s\n' "$path" "MATCH" "$url"
  else
    printf '%-45s %-10s %s\n' "$path" "MISMATCH" "$url"
    fail=1
  fi
done

exit $fail
