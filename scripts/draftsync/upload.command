#!/bin/bash
# Double-click this in Finder to upload the folder it sits in.
# (Finder runs .command files; a plain .sh opens in an editor.)
cd "$(dirname "$0")" || exit 1
/usr/bin/python3 "$(dirname "$0")/draftsync.py"
echo
echo "Done. This window can be closed."
