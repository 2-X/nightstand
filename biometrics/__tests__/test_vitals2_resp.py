import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.dirname(__file__))

from vitals2.resp import EDGE_SECONDS, WINDOW_SECONDS, estimate_resp
from vitals2_synth import FS, bcg, breathing, noise, piezo

SECONDS = WINDOW_SECONDS + 2 * EDGE_SECONDS


class EstimateRespTest(unittest.TestCase):
    def test_recovers_known_rates(self):
        for per_minute in (6, 10, 14, 18, 24, 30):
            with self.subTest(per_minute=per_minute):
                rate, quality = estimate_resp(piezo(SECONDS, bpm=64, per_minute=per_minute), FS)
                self.assertAlmostEqual(rate, per_minute, delta=0.7)
                self.assertGreaterEqual(quality, 0.5)

    def test_rates_outside_the_old_band_are_reported(self):
        rate, _ = estimate_resp(piezo(SECONDS, per_minute=22), FS)
        self.assertAlmostEqual(rate, 22, delta=0.7)

    def test_heartbeat_alone_gives_no_rate(self):
        rate, quality = estimate_resp(bcg(SECONDS, 62) + noise(SECONDS), FS)
        self.assertTrue(rate is None or quality < 0.5)

    def test_noise_has_low_quality(self):
        rate, quality = estimate_resp(noise(SECONDS, 300_000), FS)
        self.assertTrue(rate is None or quality < 0.5)

    def test_breathing_that_changes_mid_window_is_not_reported(self):
        half = SECONDS / 2
        window = np.concatenate([breathing(half, 9), breathing(half, 25)]) + noise(SECONDS)
        rate, quality = estimate_resp(window, FS)
        self.assertTrue(rate is None or quality < 0.5)


if __name__ == '__main__':
    unittest.main()
