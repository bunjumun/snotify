"""Push build/sd-game/ onto the box's SD card as /game/ over Wi-Fi.

    python3 tools/push_game.py [HOST] [SRC_DIR]     (default 192.168.0.38, build/sd-game)

Run tools/pack_game.py first. Each file goes to POST /api/sd/game-upload?path=...
(raw body). Existing files are overwritten; nothing is ever deleted. Files whose
size already matches the card are still re-sent (the box has no size probe),
so this is a full push. Prints a failure count and exits non-zero on any.
"""
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RETRIES = 3


def push(host, rel, path):
    with open(path, "rb") as f:
        body = f.read()
    url = "http://%s/api/sd/game-upload?path=%s" % (host, urllib.parse.quote(rel))
    last = None
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, data=body, method="POST",
                                         headers={"Content-Type": "application/octet-stream"})
            with urllib.request.urlopen(req, timeout=60) as r:
                if r.status == 200:
                    return len(body), None
                last = "HTTP %d" % r.status
        except urllib.error.HTTPError as e:
            last = "HTTP %d %s" % (e.code, e.read()[:120])
        except Exception as e:  # network drop: retry
            last = repr(e)
        time.sleep(1.5)
    return 0, last


def main():
    host = sys.argv[1] if len(sys.argv) > 1 else "192.168.0.38"
    src = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "..", "build", "sd-game"))
    files = []
    for root, _d, names in os.walk(src):
        for n in sorted(names):
            p = os.path.join(root, n)
            files.append((os.path.relpath(p, src).replace(os.sep, "/"), p))
    files.sort()
    failed, sent, t0 = [], 0, time.time()
    for i, (rel, p) in enumerate(files, 1):
        n, err = push(host, rel, p)
        sent += n
        if err:
            failed.append((rel, err))
            print("FAIL %s: %s" % (rel, err))
        elif i % 10 == 0 or i == len(files):
            print("%d/%d  %d KB  %.0fs" % (i, len(files), sent // 1024, time.time() - t0))
    print("pushed %d files, %d failed" % (len(files) - len(failed), len(failed)))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
