# Tests for tools/gzip_data.py (the data/ gzip staging step).
# Run: python3 test/gzip_data.test.py
import gzip
import importlib.util
import os
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("gzip_data", os.path.join(HERE, "..", "tools", "gzip_data.py"))
G = importlib.util.module_from_spec(spec)
spec.loader.exec_module(G)  # env is None outside PlatformIO, so no hook runs


def rb(path):
    with open(path, "rb") as f:
        return f.read()


def write(folder, name, data):
    with open(os.path.join(folder, name), "wb") as f:
        f.write(data if isinstance(data, bytes) else data.encode())


class ShouldCompress(unittest.TestCase):
    def test_text_page_files_compress(self):
        for name in ("index.html", "app.js", "style.css", "other.json", "APP.JS"):
            self.assertTrue(G.should_compress(name), name)

    def test_other_files_and_the_stored_playlist_stay_plain(self):
        for name in ("playlist.json", "font.woff2", "pic.png", "app.js.gz", "readme.txt"):
            self.assertFalse(G.should_compress(name), name)


class Gzip(unittest.TestCase):
    def test_round_trips_and_is_deterministic(self):
        data = b"hello hello hello hello " * 50
        a, b = G.gzip_bytes(data), G.gzip_bytes(data)
        self.assertEqual(a, b)
        self.assertEqual(gzip.decompress(a), data)

    def test_header_has_no_timestamp_or_name(self):
        packed = G.gzip_bytes(b"x" * 100)
        self.assertEqual(packed[:2], b"\x1f\x8b")
        self.assertEqual(packed[3], 0)          # no FNAME/FEXTRA flags
        self.assertEqual(packed[4:8], b"\0\0\0\0")  # mtime 0


class VersionReferences(unittest.TestCase):
    hashes = {"app.js": "aaaa1111", "style.css": "bbbb2222"}

    def test_local_script_and_stylesheet_get_a_version(self):
        html = '<link rel="stylesheet" href="style.css" /><script src="app.js"></script>'
        out = G.version_references(html, self.hashes)
        self.assertIn('href="style.css?v=bbbb2222"', out)
        self.assertIn('src="app.js?v=aaaa1111"', out)

    def test_data_urls_external_urls_and_unknown_files_are_untouched(self):
        for html in (
            '<link rel="icon" href="data:image/svg+xml,<svg></svg>" />',
            '<script src="https://example.com/app.js"></script>',
            '<script src="/app.js"></script>',
            '<script src="other.js"></script>',
            '<script src="app.js?v=1"></script>',
        ):
            self.assertEqual(G.version_references(html, self.hashes), html)


class Stage(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.src = os.path.join(self.tmp.name, "data")
        self.dst = os.path.join(self.tmp.name, "build", "data-gz")
        os.makedirs(self.src)
        write(self.src, "index.html", '<link rel="stylesheet" href="s.css" /><script src="app.js"></script>' + "<p>page</p>" * 200)
        write(self.src, "app.js", "var a = 1;\n" * 200)
        write(self.src, "s.css", "p { color: red; }\n" * 100)
        write(self.src, "loose.js", "var loose = 1;\n" * 100)  # not named by the page: ships on its own
        write(self.src, "playlist.json", '{"tracks":[]}' + " " * 400)
        write(self.src, "tiny.js", "1")  # gzip would be larger
        write(self.src, "logo.png", b"\x89PNG" + bytes(range(256)))

    def tearDown(self):
        self.tmp.cleanup()

    def staged(self):
        return sorted(n for n in os.listdir(self.dst) if n != G.MARKER)

    def test_text_files_ship_only_as_gz_and_others_plain(self):
        G.stage(self.src, self.dst)
        self.assertEqual(self.staged(), ["bundle.js.gz", "index.html.gz", "logo.png", "loose.js.gz", "playlist.json", "s.css.gz", "tiny.js"])

    def test_gz_content_is_the_original_and_the_source_is_untouched(self):
        original = rb(os.path.join(self.src, "loose.js"))
        G.stage(self.src, self.dst)
        with open(os.path.join(self.dst, "loose.js.gz"), "rb") as f:
            self.assertEqual(gzip.decompress(f.read()), original)
        self.assertEqual(rb(os.path.join(self.src, "loose.js")), original)
        self.assertIn(b'src="app.js"', rb(os.path.join(self.src, "index.html")))

    def test_index_references_carry_the_hash_of_the_staged_file(self):
        G.stage(self.src, self.dst)
        with open(os.path.join(self.dst, "index.html.gz"), "rb") as f:
            html = gzip.decompress(f.read()).decode()
        wanted = G.file_hash(rb(os.path.join(self.src, "s.css")))
        self.assertIn('href="s.css?v=%s"' % wanted, html)

    def test_changing_a_file_changes_only_its_own_version(self):
        write(self.src, "other.css", "a { top: 0; }\n" * 50)
        html = rb(os.path.join(self.src, "index.html")).decode() + '<link rel="stylesheet" href="other.css" />'
        write(self.src, "index.html", html)

        def versions():
            G.stage(self.src, self.dst)
            with open(os.path.join(self.dst, "index.html.gz"), "rb") as f:
                text = gzip.decompress(f.read()).decode()
            return dict(__import__("re").findall(r'(?:href|src)="([a-z.]+)\?v=([0-9a-f]+)"', text))

        before = versions()
        write(self.src, "other.css", "a { top: 1; }\n" * 50)
        after = versions()
        self.assertEqual(before["s.css"], after["s.css"])
        self.assertEqual(before["bundle.js"], after["bundle.js"])
        self.assertNotEqual(before["other.css"], after["other.css"])

    def test_changing_a_bundled_script_changes_the_bundle_version(self):
        def bundle_version():
            G.stage(self.src, self.dst)
            with open(os.path.join(self.dst, "index.html.gz"), "rb") as f:
                return __import__("re").search(r'bundle\.js\?v=([0-9a-f]+)', gzip.decompress(f.read()).decode()).group(1)

        before = bundle_version()
        write(self.src, "app.js", "var a = 2;\n" * 200)
        self.assertNotEqual(before, bundle_version())

    def test_rerun_drops_files_that_left_the_source(self):
        G.stage(self.src, self.dst)
        os.remove(os.path.join(self.src, "loose.js"))
        G.stage(self.src, self.dst)
        self.assertNotIn("loose.js.gz", self.staged())

    def test_output_is_identical_between_runs(self):
        G.stage(self.src, self.dst)
        first = {n: rb(os.path.join(self.dst, n)) for n in self.staged()}
        G.stage(self.src, self.dst)
        second = {n: rb(os.path.join(self.dst, n)) for n in self.staged()}
        self.assertEqual(first, second)

    def test_refuses_a_folder_it_did_not_make(self):
        os.makedirs(self.dst)
        write(self.dst, "precious.txt", "mine")
        with self.assertRaises(RuntimeError):
            G.stage(self.src, self.dst)
        self.assertTrue(os.path.exists(os.path.join(self.dst, "precious.txt")))

    def test_subfolders_are_copied_untouched(self):
        os.makedirs(os.path.join(self.src, "fonts"))
        write(os.path.join(self.src, "fonts"), "a.woff2", b"font")
        G.stage(self.src, self.dst)
        self.assertEqual(rb(os.path.join(self.dst, "fonts", "a.woff2")), b"font")


class Bundle(unittest.TestCase):
    page = (
        '<link rel="stylesheet" href="style.css" />\n<body>\n'
        '  <script src="a.js"></script>\n  <script src="b.js"></script>\n'
        '  <script src="c.js"></script>\n</body>'
    )
    files = {"a.js": b"var a=1", "b.js": b"var b=2;\n", "c.js": b"var c=3"}

    def test_scripts_join_in_page_order_with_safe_separators(self):
        html, bundle, names = G.bundle_scripts(self.page, self.files)
        self.assertEqual(names, ["a.js", "b.js", "c.js"])
        self.assertEqual(bundle, b"var a=1\n;\nvar b=2;\n\n;\nvar c=3\n;\n")

    def test_page_gets_one_tag_where_the_first_script_was(self):
        html, _, _ = G.bundle_scripts(self.page, self.files)
        self.assertEqual(html.count("<script"), 1)
        self.assertIn('<script src="bundle.js"></script>', html)
        self.assertNotIn("a.js", html)
        self.assertIn("</body>", html)

    def test_remote_and_unknown_scripts_are_left_alone(self):
        page = '<script src="a.js"></script><script src="https://x.test/z.js"></script><script src="gone.js"></script>'
        html, bundle, names = G.bundle_scripts(page, self.files)
        self.assertEqual(names, ["a.js"])
        self.assertIn("https://x.test/z.js", html)
        self.assertIn("gone.js", html)

    def test_page_with_no_local_scripts_is_unchanged(self):
        html, bundle, names = G.bundle_scripts("<p>hi</p>", self.files)
        self.assertEqual((html, bundle, names), ("<p>hi</p>", b"", []))

    def test_stage_ships_bundle_instead_of_the_separate_scripts(self):
        tmp = tempfile.TemporaryDirectory()
        src, dst = os.path.join(tmp.name, "d"), os.path.join(tmp.name, "b", "gz")
        os.makedirs(src)
        write(src, "index.html", self.page + "<p>x</p>" * 100)
        for n, b in self.files.items():
            write(src, n, b * 80)
        write(src, "style.css", "p{}" * 200)
        G.stage(src, dst)
        got = sorted(n for n in os.listdir(dst) if n != G.MARKER)
        self.assertEqual(got, ["bundle.js.gz", "index.html.gz", "style.css.gz"])
        with open(os.path.join(dst, "index.html.gz"), "rb") as f:
            html = gzip.decompress(f.read()).decode()
        with open(os.path.join(dst, "bundle.js.gz"), "rb") as f:
            want = G.file_hash(gzip.decompress(f.read()))
        self.assertIn('src="bundle.js?v=%s"' % want, html)
        tmp.cleanup()


if __name__ == "__main__":
    unittest.main()
