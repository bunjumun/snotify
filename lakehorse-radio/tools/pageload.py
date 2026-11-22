# Page-load timer: fetches "/" and every script and stylesheet it names, the way
# a browser would on a first visit (6 connections at a time, gzip accepted),
# then checks what a repeat visit would cost.
# Usage: python3 tools/pageload.py HOST [ROUNDS]     e.g. 192.168.0.38 5
# Read-only: GET requests only. Run it once with Bluetooth on and once off.
import concurrent.futures as cf
import gzip
import re
import sys
import time
import urllib.error
import urllib.request

host = sys.argv[1]
rounds = int(sys.argv[2]) if len(sys.argv) > 2 else 3
base = "http://" + host


def get(path, headers=None):
    """Returns (path, status, body_bytes_on_wire, seconds, headers, body, ok).
    ok is False when the body is short or the request failed: a 200 with an
    empty body is a failure, not a fast page (seen 2026-11-22, see HANDOFF)."""
    req = urllib.request.Request(base + path, headers={"Accept-Encoding": "gzip", **(headers or {})})
    t = time.time()
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            body = r.read()
            want = r.headers.get("Content-Length")
            ok = want is None or int(want) == len(body)
            return path, r.status, len(body), time.time() - t, dict(r.headers), body, ok
    except urllib.error.HTTPError as e:  # 304 arrives here
        return path, e.code, 0, time.time() - t, dict(e.headers), b"", e.code == 304
    except Exception as e:  # short read, reset, timeout
        return path, 0, 0, time.time() - t, {}, b"", False


def text_of(result):
    body = result[5]
    if result[4].get("Content-Encoding") == "gzip":
        try:
            body = gzip.decompress(body)
        except Exception:
            return ""
    return body.decode("utf-8", "replace")


def refs(html):
    return re.findall(r'(?:src|href)="([A-Za-z0-9_.\-]+\.(?:js|css)(?:\?[^"]*)?)"', html)


walls = []
fails = 0
for i in range(rounds):
    t0 = time.time()
    first = get("/")
    names = ["/" + n for n in refs(text_of(first))]
    with cf.ThreadPoolExecutor(6) as ex:
        got = [first] + list(ex.map(get, names))
    wall = time.time() - t0
    walls.append(wall)
    bad = [g[0] for g in got if not g[6]]
    fails += len(bad)
    print("round %d: %d files, %d bytes on the wire, %.2f s wall%s" % (i + 1, len(got), sum(g[2] for g in got), wall, ("  FAILED: " + ", ".join(bad)) if bad else ""))
    time.sleep(1)

walls.sort()
print("first-load wall time: best %.2f s, median %.2f s, worst %.2f s; %d failed or short responses" % (walls[0], walls[len(walls) // 2], walls[-1], fails))
print()
print("%-24s %-8s %-5s %-30s %s" % ("file", "bytes", "gzip", "Cache-Control", "ETag"))
for p, st, n, dt, h, _, ok in got:
    print("%-24s %-8d %-5s %-30s %s" % (p + ("" if ok else " [BAD]"), n, "yes" if h.get("Content-Encoding") == "gzip" else "no", h.get("Cache-Control", "-"), h.get("ETag", "-")))

print()
print("repeat visit: conditional requests for files with no max-age (index.html should answer 304)")
for p, st, n, dt, h, _, ok in got:
    cc = h.get("Cache-Control", "")
    if "max-age" in cc and "no-cache" not in cc:
        print("%-24s skipped, browser serves it from cache for %s" % (p, re.search(r"max-age=(\d+)", cc).group(1) + " s"))
    elif "ETag" in h:
        r = get(p, {"If-None-Match": h["ETag"]})
        print("%-24s -> %d in %.2f s" % (p, r[1], r[3]))

sys.exit(1 if fails else 0)
