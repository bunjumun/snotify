"""Push one small allowlisted file to the box's SD card root over Wi-Fi.

    python3 tools/push_card_file.py [FILE] [HOST] [--key KEY]

Defaults: FILE = band-tracks.json (next to this tool's parent folder), HOST =
lakehorseradio.local. Sends the raw body to POST /api/sd/card-file?name=<basename>.
The box accepts only names on cfg::CARD_FILE_NAMES (src/config.h) and checks the
content before replacing the old file, so a refused upload leaves the card as it was.
With the pairing key switched on (cfg::SD_WRITES_NEED_KEY) pass --key, or set
LAKEHORSE_KEY; the key is sent as the X-Lakehorse-Key header and never printed.

The file is also checked here first (valid JSON, a "tracks" list of names, at most
4096 bytes) so an obvious mistake is caught before the network. The box repeats the
check; this is a courtesy, not the gate. Exits non-zero on any failure.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_FILE = os.path.join(HERE, "..", "band-tracks.json")
DEFAULT_HOST = "lakehorseradio.local"
MAX_BYTES = 4096  # cfg::CARD_FILE_MAX_BYTES


def check_band_tracks(body):
    """Return an error string, or None when the body looks like what the box reads."""
    if not body:
        return "the file is empty"
    if len(body) > MAX_BYTES:
        return "the file is %d bytes; the box takes at most %d" % (len(body), MAX_BYTES)
    try:
        doc = json.loads(body.decode("utf-8"))
    except ValueError as e:
        return "not valid JSON: %s" % e
    if not isinstance(doc, dict):
        return 'expected an object like {"version":1,"tracks":[...]}'
    if "version" in doc and doc["version"] != 1:
        return '"version" must be 1'
    tracks = doc.get("tracks")
    if not isinstance(tracks, list) or any(not isinstance(t, str) or not t for t in tracks):
        return '"tracks" must be a list of non-empty file names'
    return None


def main(argv):
    args, key = [], os.environ.get("LAKEHORSE_KEY")
    it = iter(argv)
    for a in it:
        if a == "--key":
            key = next(it, None)
        else:
            args.append(a)
    path = os.path.abspath(args[0] if args else DEFAULT_FILE)
    host = args[1] if len(args) > 1 else DEFAULT_HOST
    name = os.path.basename(path)
    with open(path, "rb") as f:
        body = f.read()
    if name == "band-tracks.json":
        err = check_band_tracks(body)
        if err:
            print("not sent: %s" % err)
            return 1
    url = "http://%s/api/sd/card-file?name=%s" % (host, urllib.parse.quote(name))
    headers = {"Content-Type": "application/octet-stream"}
    if key:
        headers["X-Lakehorse-Key"] = key
    try:
        req = urllib.request.Request(url, data=body, method="POST", headers=headers)
        with urllib.request.urlopen(req, timeout=30) as r:
            print("sent %s (%d bytes): %s" % (name, len(body), r.read().decode()))
            return 0
    except urllib.error.HTTPError as e:
        print("refused by the box (HTTP %d): %s" % (e.code, e.read().decode(errors="replace")[:200]))
    except Exception as e:  # network trouble
        print("could not reach %s: %r" % (host, e))
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
