# Tests for tools/push_card_file.py (the courtesy check before sending band-tracks.json).
# Run: python3 -B test/push_card_file.test.py
import importlib.util
import os
import sys
import unittest

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("push_card_file", os.path.join(HERE, "..", "tools", "push_card_file.py"))
P = importlib.util.module_from_spec(spec)
spec.loader.exec_module(P)


class CheckBandTracks(unittest.TestCase):
    def test_good_list(self):
        self.assertIsNone(P.check_band_tracks(b'{"version":1,"tracks":["A.wav","B C.wav"]}'))

    def test_version_optional_and_empty_list_ok(self):
        self.assertIsNone(P.check_band_tracks(b'{"tracks":[]}'))

    def test_bad_inputs_are_refused(self):
        for body in (b"", b"nope", b"[]", b'{"version":2,"tracks":[]}', b'{"tracks":"A.wav"}',
                     b'{"tracks":[1]}', b'{"tracks":[""]}', b'{"version":1}'):
            self.assertIsNotNone(P.check_band_tracks(body), body)

    def test_over_the_cap_is_refused(self):
        body = b'{"tracks":["' + b"a" * P.MAX_BYTES + b'.wav"]}'
        self.assertIn("at most", P.check_band_tracks(body))

    def test_the_shipped_starter_list_passes(self):
        with open(os.path.join(HERE, "..", "band-tracks.json"), "rb") as f:
            self.assertIsNone(P.check_band_tracks(f.read()))


if __name__ == "__main__":
    unittest.main()
