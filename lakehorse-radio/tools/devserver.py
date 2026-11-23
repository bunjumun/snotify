#!/usr/bin/env python3
"""Preview the page from data/ on this Mac, with /api/* passed to a real box.

Why: checking a page change otherwise means flashing the LittleFS image. This
serves the unbundled files straight from data/ (so edits show on reload) and
forwards every /api/ and /sd/ request to the box, so the page behaves as it
does there. Anything it forwards really reaches the box, POSTs included.

  python3 tools/devserver.py 192.168.0.38 8765
"""
import http.server
import os
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), "data")
BOX = sys.argv[1] if len(sys.argv) > 1 else "192.168.0.38"
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8765


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=DATA, **kw)

    def _proxy(self):
        body = None
        n = int(self.headers.get("Content-Length") or 0)
        if n:
            body = self.rfile.read(n)
        req = urllib.request.Request(f"http://{BOX}{self.path}", data=body, method=self.command)
        for h in ("Content-Type", "X-Lakehorse-Key", "Range"):
            if self.headers.get(h):
                req.add_header(h, self.headers[h])
        extra = {}
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                data, code, ctype = r.read(), r.status, r.headers.get("Content-Type", "")
                extra = {k: r.headers[k] for k in ("Content-Range", "Accept-Ranges") if r.headers.get(k)}
        except urllib.error.HTTPError as e:
            data, code, ctype = e.read(), e.code, e.headers.get("Content-Type", "")
        except Exception as e:  # box unreachable
            data, code, ctype = str(e).encode(), 502, "text/plain"
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        for k, v in extra.items():
            self.send_header(k, v)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith(("/api/", "/sd/")):
            return self._proxy()
        super().do_GET()

    def do_POST(self):
        self._proxy()

    def end_headers(self):
        if not self.path.startswith(("/api/", "/sd/")):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    print(f"serving {DATA} on http://localhost:{PORT}, /api and /sd -> {BOX}")
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
