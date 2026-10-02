import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from vitals2._acf import _near, acf_period


class AcfPeriodTest(unittest.TestCase):
    def test_period_at_the_longest_lag_is_found(self):
        t = np.arange(1000) / 100.0
        pulses = sum(np.exp(-((t - centre) / 0.05) ** 2) for centre in np.arange(0.3, 10, 2.0))
        period, quality = acf_period(pulses, 100.0, 0.375, 2.0)
        self.assertAlmostEqual(period, 2.0, delta=0.01)
        self.assertGreater(quality, 0.5)

    def test_fifth_multiple_walks_down_to_the_period(self):
        # A clean sinusoid has equal peaks at every multiple, and depending on
        # phase the highest one can be the fifth.
        t = np.arange(600) / 10.0
        for phase in (0.52, 1.05, 1.57, 4.71):
            with self.subTest(phase=phase):
                values = np.sin(2 * np.pi * t / 2.0 + phase)
                values += np.random.default_rng(int(phase * 10)).normal(0.0, 0.01, t.size)
                period, _ = acf_period(values, 10.0, 60 / 36, 12.0)
                self.assertAlmostEqual(period, 2.0, delta=0.02)

    def test_near_takes_the_highest_peak_in_tolerance(self):
        peaks = np.array([96, 103])
        heights = np.zeros(110)
        heights[96], heights[103] = 0.4, 0.9
        self.assertEqual(_near(peaks, heights, 100.0), 103)
        self.assertIsNone(_near(peaks, heights, 50.0))

    def test_flat_input_has_no_period(self):
        self.assertEqual(acf_period(np.zeros(500), 100.0, 0.375, 2.0), (None, 0.0))


if __name__ == '__main__':
    unittest.main()
