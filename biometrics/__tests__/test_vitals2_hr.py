import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.dirname(__file__))

from vitals2.gates import HR_MIN_QUALITY
from vitals2.hr import EDGE_SECONDS, WINDOW_SECONDS, estimate_hr
from vitals2_synth import FS, bcg, breathing, noise, piezo, pink_noise

SECONDS = WINDOW_SECONDS + 2 * EDGE_SECONDS
SEEDS = range(5)


def realistic(bpm, seed):
    """Beat jitter, breathing modulation of the beats and 1/f noise."""
    return piezo(SECONDS, bpm=bpm, jitter_ms=40, seed=seed, modulation=0.3, pink_level=25_000)


class EstimateHrTest(unittest.TestCase):
    def test_recovers_known_rates(self):
        for bpm in (42, 55, 63, 78, 95, 120):
            with self.subTest(bpm=bpm):
                estimate, quality = estimate_hr(piezo(SECONDS, bpm=bpm), FS)
                self.assertAlmostEqual(estimate, bpm, delta=1.0)
                self.assertGreaterEqual(quality, 0.5)

    def test_breathing_does_not_leak_into_the_rate(self):
        window = bcg(SECONDS, 66) + breathing(SECONDS, 16, amplitude=3_000_000) + noise(SECONDS)
        estimate, _ = estimate_hr(window, FS)
        self.assertAlmostEqual(estimate, 66, delta=1.0)

    def test_fast_heart_is_not_halved(self):
        estimate, _ = estimate_hr(piezo(SECONDS, bpm=110), FS)
        self.assertAlmostEqual(estimate, 110, delta=1.5)

    def test_second_hump_is_not_counted_as_a_beat(self):
        window = bcg(SECONDS, 60, second_hump=0.5) + noise(SECONDS)
        estimate, _ = estimate_hr(window, FS)
        self.assertAlmostEqual(estimate, 60, delta=1.0)

    def test_previous_rate_settles_an_ambiguous_harmonic(self):
        # Two equal humps per beat: the window alone cannot tell 58 from 116.
        window = bcg(SECONDS, 58, second_hump=1.0) + noise(SECONDS)
        low, _ = estimate_hr(window, FS, previous_bpm=60)
        high, _ = estimate_hr(window, FS, previous_bpm=112)
        self.assertAlmostEqual(low, 58, delta=1.5)
        self.assertAlmostEqual(high, 116, delta=3.0)

    def test_noise_has_low_quality(self):
        _, quality = estimate_hr(noise(SECONDS, 200_000), FS)
        self.assertLess(quality, 0.5)

    def test_flat_window_has_no_estimate(self):
        self.assertEqual(estimate_hr(np.zeros(int(SECONDS * FS)), FS), (None, 0.0))



class RealisticWindowTest(unittest.TestCase):
    def assert_tracks(self, results, bpm, min_passing=3):
        """Every passing estimate is within 5% of bpm, and most windows pass."""
        passing = [estimate for estimate, quality in results if quality >= HR_MIN_QUALITY]
        for estimate in passing:
            self.assertAlmostEqual(estimate, bpm, delta=0.05 * bpm)
        self.assertGreaterEqual(len(passing), min_passing)

    def test_recovers_known_rates(self):
        for bpm in (42, 55, 63, 78, 95, 120):
            with self.subTest(bpm=bpm):
                self.assert_tracks([estimate_hr(realistic(bpm, seed), FS) for seed in SEEDS], bpm)

    def test_slow_and_fast_rates(self):
        for bpm in (32, 150):
            with self.subTest(bpm=bpm):
                self.assert_tracks([estimate_hr(realistic(bpm, seed), FS) for seed in SEEDS], bpm)

    def test_rate_jumps_are_not_halved_by_the_previous_rate(self):
        for previous, bpm in ((60, 90), (75, 120), (50, 80), (40, 60)):
            with self.subTest(previous=previous, bpm=bpm):
                results = [estimate_hr(realistic(bpm, seed), FS, previous_bpm=previous) for seed in SEEDS]
                self.assert_tracks(results, bpm)

    def test_smaller_second_hump_is_not_read_as_a_doubled_rate(self):
        results = []
        for seed in range(10):
            window = (bcg(SECONDS, 60, jitter_ms=30, second_hump=0.7, seed=seed, modulation=0.3)
                      + breathing(SECONDS, 15) + noise(SECONDS, seed=seed + 1) + pink_noise(SECONDS, 25_000, seed + 2))
            results.append(estimate_hr(window, FS))
        self.assert_tracks(results, 60, min_passing=8)

    def test_lower_sample_rate(self):
        # Every other sample of a 500 Hz window is what a 250 Hz sensor reads.
        self.assert_tracks([estimate_hr(realistic(70, seed)[::2], 250.0) for seed in SEEDS], 70, min_passing=5)


if __name__ == '__main__':
    unittest.main()
