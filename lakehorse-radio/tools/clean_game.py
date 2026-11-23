"""Remove files an older pack left on the box's SD card under /game/.

    python3 tools/clean_game.py [HOST] [--dry]

Stale means: the separate game modules (src/**, plain and .gz) and the old
top-level bundle.js(.gz), from before the bundle moved to src/audio/bundle.js.
The list is built from the repo's game/src tree, never from the card, and the
live bundle, index, config, music.json, vendor/ and guber-eats/ are not in it.
Files only (the box refuses folders); empty folders stay. 404 means already gone.
"""
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
GAME_SRC = os.path.abspath(os.path.join(HERE, "..", "..", "game", "src"))
LIVE = {"src/audio/bundle.js", "src/audio/bundle.js.gz"}


def stale_paths():
    out = ["bundle.js", "bundle.js.gz"]
    for root, _d, names in os.walk(GAME_SRC):
        for n in names:
            rel = "src/" + os.path.relpath(os.path.join(root, n), GAME_SRC).replace(os.sep, "/")
            out += [rel, rel + ".gz"]
    return sorted(p for p in out if p not in LIVE)


def delete(host, rel):
    url = "http://%s/api/sd/game-delete?path=%s" % (host, urllib.parse.quote(rel))
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method="POST"), timeout=20) as r:
            return "removed" if r.status == 200 else "HTTP %d" % r.status
    except urllib.error.HTTPError as e:
        return "already gone" if e.code == 404 else "HTTP %d" % e.code
    except Exception as e:
        return repr(e)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    host = args[0] if args else "192.168.0.38"
    paths = stale_paths()
    if "--dry" in sys.argv:
        print("\n".join(paths)); print(len(paths), "paths")
        return
    tally = {}
    for p in paths:
        r = delete(host, p)
        tally[r] = tally.get(r, 0) + 1
        if r not in ("removed", "already gone"):
            print("FAIL", p, r)
    print(tally)


if __name__ == "__main__":
    main()
