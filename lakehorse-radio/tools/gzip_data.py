"""Build step: stage a gzipped copy of data/ and point the filesystem image at it.

Why: the box serves its page from a 512 KB LittleFS partition, and with
Bluetooth on a download runs at only 22-40 KB/s, so page weight is load time.
The text files (html, js, css, json) compress to a third or less.

What it does, every time PlatformIO loads an environment that lists it:
  1. Copies data/ to <build dir>/data-gz/.
  2. Joins the page's local scripts into bundle.js (one request instead of ten).
     Replaces each text file with NAME.gz (deterministic bytes: no timestamp,
     no stored file name), unless the gzip would not be smaller.
  3. In index.html, adds ?v=<hash of that file> to the local script and
     stylesheet references. The static handler ignores query strings, so the
     files are still found, but a changed file now has a new URL, which is what
     lets web_server.cpp give them a long cache lifetime safely.
  4. Sets PROJECT_DATA_DIR to the staged copy, so `buildfs` and `uploadfs`
     build the image from it. data/ itself is never modified, and the JS tests
     keep requiring the plain files from data/.

The library side (ESPAsyncWebServer 3.12.1 serveStatic) serves NAME.gz when
NAME is asked for, sets Content-Encoding: gzip, and takes the ETag from the
CRC in the gzip trailer. See HANDOFF.md, "Shell Module 1".

The functions are pure and tested by test/gzip_data.test.py
(`python3 test/gzip_data.test.py`). The SCons part at the bottom only runs
inside PlatformIO.
"""

import gzip
import hashlib
import io
import os
import re
import shutil

COMPRESS_EXTENSIONS = (".html", ".js", ".css", ".json")

# Files the firmware opens by their plain name, so they must stay plain.
# playlist.json is the one the page's playlist is stored in at runtime
# (cfg::PLAYLIST_PATH, written by playlist_store.cpp).
KEEP_PLAIN = frozenset({"playlist.json"})

# Written into the staging directory so a later run knows it is ours to empty.
MARKER = ".gzip-staging"

# Local script and stylesheet references in index.html: src="x.js", href="x.css".
# Anything with a slash, colon, query or fragment (a data: URL, a full URL, a
# path) is deliberately not matched.
_REF = re.compile(r'(?P<attr>\b(?:src|href))="(?P<name>[A-Za-z0-9_.\-]+\.(?:js|css))"')


def should_compress(name):
    """True for a top-level page file that ships as NAME.gz."""
    if name in KEEP_PLAIN or name.endswith(".gz"):
        return False
    return name.lower().endswith(COMPRESS_EXTENSIONS)


def gzip_bytes(data):
    """Gzip with fixed header fields so the same input is the same output."""
    buf = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=buf, mtime=0, compresslevel=9) as gz:
        gz.write(data)
    return buf.getvalue()


def file_hash(data):
    return hashlib.sha1(data).hexdigest()[:8]


def version_references(html, hashes):
    """Add ?v=HASH to references whose target is in `hashes` (name -> hash)."""

    def swap(match):
        name = match.group("name")
        if name not in hashes:
            return match.group(0)
        return '%s="%s?v=%s"' % (match.group("attr"), name, hashes[name])

    return _REF.sub(swap, html)


BUNDLE_NAME = "bundle.js"

# A plain local classic script tag on its own: <script src="x.js"></script>.
_SCRIPT = re.compile(r'[ \t]*<script src="(?P<name>[A-Za-z0-9_.\-]+\.js)"(?P<late> data-late)?></script>[ \t]*\n?')

LATE_NAME = "late.js"
# Runs once the page has loaded: the first screen never waits for late.js.
_LATE_LOADER = (
    '  <script data-late-src="%s">(function(){var u=document.currentScript.getAttribute("data-late-src");'
    'addEventListener("load",function(){setTimeout(function(){'
    'var s=document.createElement("script");s.src=u;document.body.appendChild(s)},800)})})()</script>\n'
)


def bundle_scripts(html, files):
    """Replace the page's local script tags with one tag for a joined file.

    Why: the box answers one request at a time at about 0.25 s each, so the
    number of files costs more than their size. `files` maps name -> bytes.
    Tags marked data-late go into a second file, late.js, which a small inline
    loader fetches after the page's load event (keeps the first load small).
    Returns (new_html, bundle_bytes, bundled_names, late_bytes, late_names). The scripts are joined in
    page order, each followed by a ';' line so a file that does not end in a
    semicolon cannot run into the next. The one tag sits where the first script
    was. Tags for files not in `files`, and remote scripts, are left alone.
    """
    names, parts, late_names, late_parts = [], [], [], []

    def swap(match):
        name = match.group("name")
        if name not in files:
            return match.group(0)
        if match.group("late"):
            late_names.append(name)
            late_parts.append(files[name] + b"\n;\n")
            return _LATE_LOADER % LATE_NAME if len(late_names) == 1 else ""
        names.append(name)
        parts.append(files[name] + b"\n;\n")
        if len(names) > 1:
            return ""
        return '  <script src="%s"></script>\n' % BUNDLE_NAME

    new_html = _SCRIPT.sub(swap, html)
    return new_html, b"".join(parts), names, b"".join(late_parts), late_names


INLINE_MARKER = "<!-- inline-critical -->"
_STYLE_LINK = re.compile(r'[ \t]*<link rel="stylesheet" href="(?P<name>[A-Za-z0-9_.\-]+\.css)" ?/?>[ \t]*\n?')


def inline_critical(html, files):
    """Fold the stylesheet and the bundle into the page when it carries INLINE_MARKER.

    Why: the box serves several large responses at once badly on a lossy
    Bluetooth-sharing link (3 parallel files took 13 to 40 s where the same
    files one after another took 2 s), so the first screen is one request.
    A file whose text contains its own closing tag is left as a separate file.
    Returns (new_html, inlined_names).
    """
    if INLINE_MARKER not in html:
        return html, []
    inlined = []

    def style(match):
        name = match.group("name")
        data = files.get(name)
        if data is None or b"</style" in data.lower():
            return match.group(0)
        inlined.append(name)
        return "<style>\n" + data.decode("utf-8") + "\n</style>\n"

    def script(match):
        data = files.get(BUNDLE_NAME)
        if data is None or b"</script" in data.lower() or BUNDLE_NAME in inlined:
            return match.group(0)
        inlined.append(BUNDLE_NAME)
        return "  <script>\n" + data.decode("utf-8") + "\n  </script>\n"

    html = _STYLE_LINK.sub(style, html)
    html = re.sub(r'[ \t]*<script src="%s"></script>[ \t]*\n?' % re.escape(BUNDLE_NAME), script, html)
    return html, inlined


def stage(src_dir, dst_dir):
    """Build the staged copy. Returns a list of (name, plain_bytes, shipped_bytes, shipped_name)."""
    if os.path.exists(dst_dir):
        if not os.path.exists(os.path.join(dst_dir, MARKER)):
            raise RuntimeError("%s exists and was not made by gzip_data.py; not touching it" % dst_dir)
        shutil.rmtree(dst_dir)
    os.makedirs(dst_dir)
    with open(os.path.join(dst_dir, MARKER), "w") as marker:
        marker.write("generated by tools/gzip_data.py; safe to delete\n")

    # Sub-folders (fonts, images later) are copied as they are, not compressed.
    for entry in sorted(os.listdir(src_dir)):
        if os.path.isdir(os.path.join(src_dir, entry)):
            shutil.copytree(os.path.join(src_dir, entry), os.path.join(dst_dir, entry))

    names = sorted(n for n in os.listdir(src_dir) if os.path.isfile(os.path.join(src_dir, n)))
    contents = {}
    for name in names:
        with open(os.path.join(src_dir, name), "rb") as f:
            contents[name] = f.read()

    if "index.html" in contents:
        html, bundle, bundled, late, late_names = bundle_scripts(contents["index.html"].decode("utf-8"), contents)
        if bundled or late_names:
            contents["index.html"] = html.encode("utf-8")
            for name in bundled + late_names:
                del contents[name]
            if bundled:
                contents[BUNDLE_NAME] = bundle
            if late_names:
                contents[LATE_NAME] = late
            names = sorted(contents)

    if "index.html" in contents:
        html, inlined = inline_critical(contents["index.html"].decode("utf-8"), contents)
        if inlined:
            contents["index.html"] = html.encode("utf-8")
            for name in inlined:
                del contents[name]
            names = sorted(contents)

    hashes = {n: file_hash(b) for n, b in contents.items() if n.lower().endswith((".js", ".css"))}
    if "index.html" in contents:
        html = contents["index.html"].decode("utf-8")
        contents["index.html"] = version_references(html, hashes).encode("utf-8")

    report = []
    for name in names:
        data = contents[name]
        shipped_name, shipped = name, data
        if should_compress(name):
            packed = gzip_bytes(data)
            if len(packed) < len(data):
                shipped_name, shipped = name + ".gz", packed
        with open(os.path.join(dst_dir, shipped_name), "wb") as f:
            f.write(shipped)
        report.append((name, len(data), len(shipped), shipped_name))
    return report


def summary(report):
    plain = sum(r[1] for r in report)
    shipped = sum(r[2] for r in report)
    return "gzip_data: %d files, %d bytes -> %d bytes in the filesystem image" % (len(report), plain, shipped)


# ---- PlatformIO hook (not run when imported by the tests) ----
try:
    Import("env")  # noqa: F821 - provided by SCons
except NameError:
    env = None

if env is not None:
    _src = env.subst("$PROJECT_DATA_DIR")
    _dst = os.path.join(env.subst("$BUILD_DIR"), "data-gz")
    print(summary(stage(_src, _dst)))
    env.Replace(PROJECT_DATA_DIR=_dst)
