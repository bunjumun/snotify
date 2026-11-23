"""Tests for tools/pack_game.py. Run: python3 test/pack_game.test.py"""
import gzip
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import pack_game  # noqa: E402

INDEX = '<head><script type="importmap">{ "imports": { "three": "../vendor/three.module.min.js" } }</script></head>'


class PackGame(unittest.TestCase):
    def test_patch_points_import_map_inside_game_folder(self):
        out = pack_game.patch_index(INDEX)
        self.assertIn('"./vendor/three.module.min.js"', out)
        self.assertNotIn('"../vendor', out)

    def test_marker_precedes_import_map(self):
        out = pack_game.patch_index(INDEX)
        self.assertLess(out.index("LAKEHORSE_BOX"), out.index("importmap"))

    def test_patch_refuses_an_unexpected_index(self):
        with self.assertRaises(ValueError):
            pack_game.patch_index("<html></html>")

    def test_use_bundle_swaps_the_entry_script(self):
        out = pack_game.use_bundle('<script type="module" src="./src/main.js"></script>')
        self.assertIn('src="./src/audio/bundle.js"', out)
        with self.assertRaises(ValueError):
            pack_game.use_bundle("<html></html>")

    def test_gzip_roundtrips_and_is_deterministic(self):
        self.assertEqual(gzip.decompress(pack_game.gz_bytes(b"abc" * 50)), b"abc" * 50)
        self.assertEqual(pack_game.gz_bytes(b"x"), pack_game.gz_bytes(b"x"))

    def test_pack_real_game_writes_expected_files(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "game")
            plain, packed = pack_game.pack(pack_game.SITE, out)
            self.assertGreater(plain, packed)
            entry = "src/audio/bundle.js.gz" if shutil.which("esbuild") else "src/main.js.gz"
            for rel in ("index.html", "index.html.gz", entry, "vendor/three.module.min.js.gz", "music.json"):
                self.assertTrue(os.path.exists(os.path.join(out, rel)), rel)
            self.assertFalse(os.path.exists(os.path.join(out, "PROGRESS.md")))
            with open(os.path.join(out, "index.html"), encoding="utf-8") as f:
                self.assertIn("LAKEHORSE_BOX", f.read())


if __name__ == "__main__":
    unittest.main()
