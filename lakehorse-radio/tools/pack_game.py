"""Pack the Lakehorse Swimulator into a folder to copy onto the radio's SD card.

    python3 tools/pack_game.py [OUT_DIR]        (default: build/sd-game)

Copy OUT_DIR's contents to the card as /game/ (so the card has /game/index.html).
The box serves /game/* from there (web_server.cpp handleGameFile).

What it does:
  1. Copies game/ (minus notes) and the vendored Three.js next to it, since the
     box serves nothing outside /game/.
  2. Points the import map at ./vendor/ instead of ../vendor/.
  3. Injects `window.LAKEHORSE_BOX = true` ahead of the game's scripts, which is
     what makes the game skip Supabase and read songs from the card
     (game/src/core/Box.js).
  4. Writes NAME.gz beside every text file; the box sends the .gz when the phone
     accepts gzip. The plain file stays as the fallback.

No bundler on purpose: the repo has no build step, and the SD card has room.
Pure functions are tested by test/pack_game.test.py.
"""
import gzip
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.abspath(os.path.join(HERE, "..", ".."))
TEXT_EXT = (".html", ".js", ".mjs", ".css", ".json")
SKIP = ("PROGRESS.md",)
BOX_MARK = "<script>window.LAKEHORSE_BOX = true;</script>\n"
IMPORTMAP_OLD = '"three": "../vendor/three.module.min.js"'
IMPORTMAP_NEW = '"three": "./vendor/three.module.min.js"'
IMPORTMAP_TAG = '<script type="importmap">'
ENTRY_OLD = '<script type="module" src="./src/main.js"></script>'
BUNDLE_PATH = "src/audio/bundle.js"
ENTRY_NEW = '<script type="module" src="./%s"></script>' % BUNDLE_PATH


def patch_index(html):
    """Return index.html for the box. Raises if the import map is not as expected."""
    if IMPORTMAP_OLD not in html or IMPORTMAP_TAG not in html:
        raise ValueError("game/index.html import map changed; update pack_game.py")
    html = html.replace(IMPORTMAP_OLD, IMPORTMAP_NEW, 1)
    # The marker must run before any module, and the import map must precede
    # modules too, so put the marker straight before the import map.
    return html.replace(IMPORTMAP_TAG, BOX_MARK + IMPORTMAP_TAG, 1)


def use_bundle(html):
    """Point the page at the single bundle instead of the 52 module files."""
    if ENTRY_OLD not in html:
        raise ValueError("game/index.html entry script changed; update pack_game.py")
    return html.replace(ENTRY_OLD, ENTRY_NEW, 1)


def bundle(game_src, out_dir):
    """esbuild src/main.js into out_dir/bundle.js. Three.js stays external (import map).

    Why: the box serves a few connections at a time, and a browser asking for 54
    files at once drops some, which the game reports as "The water would not
    load". Returns True when bundled, False when esbuild is missing (the pack then
    keeps the separate modules, which still work on a patient connection)."""
    exe = shutil.which("esbuild")
    if not exe:
        print("pack_game: esbuild not found (brew install esbuild); keeping 52 separate modules")
        return False
    subprocess.run([exe, "src/main.js", "--bundle", "--format=esm", "--external:three", "--minify",
                    "--target=es2020", "--outfile=" + os.path.join(out_dir, "bundle.js")],
                   cwd=game_src, check=True, stdout=subprocess.DEVNULL)
    # AudioDirector reads new URL('../../music.json', import.meta.url), which only lands on
    # /game/music.json when the script sits two folders deep, as AudioDirector.js did.
    # So the bundle lives at src/audio/bundle.js rather than at the top level.
    shutil.rmtree(os.path.join(out_dir, "src"))
    os.makedirs(os.path.join(out_dir, os.path.dirname(BUNDLE_PATH)))
    os.rename(os.path.join(out_dir, "bundle.js"), os.path.join(out_dir, BUNDLE_PATH))
    return True


def gz_bytes(data):
    """Deterministic gzip (no timestamp, no name), like gzip_data.py."""
    return gzip.compress(data, compresslevel=9, mtime=0)


def pack(site, out_dir):
    game_src = os.path.join(site, "game")
    vendor_src = os.path.join(site, "vendor")
    if os.path.exists(out_dir):
        shutil.rmtree(out_dir)
    shutil.copytree(game_src, out_dir, ignore=shutil.ignore_patterns(*SKIP))
    shutil.copytree(vendor_src, os.path.join(out_dir, "vendor"))
    # Guber Eats: a single-file game whose "../vendor/three.module.min.js"
    # import resolves to /game/vendor/ from /game/guber-eats/, so it needs no edit.
    guber_src = os.path.join(site, "guber-eats", "index.html")
    if os.path.exists(guber_src):
        os.makedirs(os.path.join(out_dir, "guber-eats"))
        with open(guber_src, encoding="utf-8") as f:
            guber = f.read()
        # LAKEHORSE_BOX makes its soundtrack the SD card's songs, Currency first.
        assert IMPORTMAP_TAG in guber, "guber-eats import map not found"
        with open(os.path.join(out_dir, "guber-eats", "index.html"), "w", encoding="utf-8") as f:
            f.write(guber.replace(IMPORTMAP_TAG, BOX_MARK + IMPORTMAP_TAG, 1))

    bundled = bundle(game_src, out_dir)
    index = os.path.join(out_dir, "index.html")
    with open(index, encoding="utf-8") as f:
        patched = patch_index(f.read())
        if bundled:
            patched = use_bundle(patched)
    with open(index, "w", encoding="utf-8") as f:
        f.write(patched)

    plain = packed = 0
    for root, _dirs, names in os.walk(out_dir):
        for name in names:
            path = os.path.join(root, name)
            if not name.endswith(TEXT_EXT):
                continue
            with open(path, "rb") as f:
                data = f.read()
            z = gz_bytes(data)
            with open(path + ".gz", "wb") as f:
                f.write(z)
            plain += len(data)
            packed += len(z)
    return plain, packed


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "build", "sd-game")
    out = os.path.abspath(out)
    plain, packed = pack(SITE, out)
    print("pack_game: %d bytes of text -> %d gzipped, in %s" % (plain, packed, out))
