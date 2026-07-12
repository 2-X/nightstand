"""Tests for the numpy-free rolling-floor decision helpers.

These cover the pure decision logic that drives the `is_ambiguous_both` exit
break (see biometrics/stream/presence_floor.py). Because presence_floor.py
has no numpy dependency, this module runs on any Python without numpy
installed, unlike test_presence_ambiguous_floor.py, which exercises the
full BiometricProcessor and needs a real Python environment with numpy.

Run locally:
    cd biometrics && python3 -m unittest __tests__.test_presence_floor -v
"""
import unittest
import os
import sys

# presence_floor lives in biometrics/stream/; put it on the path.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'stream'))

from presence_floor import (
    low_percentile,
    floor_looks_empty,
    ambiguous_should_advance,
    update_occupied_floor_est,
)


class TestLowPercentile(unittest.TestCase):
    def test_empty_is_zero(self):
        self.assertEqual(low_percentile([], 20), 0.0)
        self.assertEqual(low_percentile(None, 20), 0.0)

    def test_single_value(self):
        self.assertEqual(low_percentile([5.0], 20), 5.0)

    def test_p0_and_p100_are_min_and_max(self):
        vals = [10.0, 30.0, 20.0, 40.0]
        self.assertEqual(low_percentile(vals, 0), 10.0)
        self.assertEqual(low_percentile(vals, 100), 40.0)

    def test_matches_linear_interpolation(self):
        # np.percentile([0,1,2,3,4], 20) == 0.8 under the default linear method.
        self.assertAlmostEqual(low_percentile([0, 1, 2, 3, 4], 20), 0.8)
        # p50 of an even-length list interpolates the two middle values.
        self.assertAlmostEqual(low_percentile([0, 10, 20, 30], 50), 15.0)

    def test_low_percentile_exposes_the_floor_not_the_bursts(self):
        # A mostly-low window with a few ceiling-clipping bursts: p20 sits near
        # the between-burst floor, the max is dominated by the bursts. This is
        # the whole point of using a low percentile.
        window = [700_000] * 40 + [16_777_215] * 10  # 20% bursts
        self.assertLess(low_percentile(window, 20), 800_000)
        self.assertEqual(max(window), 16_777_215)


class TestFloorLooksEmpty(unittest.TestCase):
    def test_false_until_window_ready(self):
        # Even a floor far below the reference is ignored until the window fills
        # -- warmup must never trigger an exit.
        self.assertFalse(floor_looks_empty(100_000, 2_500_000, 0.30, window_ready=False))

    def test_false_without_a_reference(self):
        # No learned occupied floor yet => never "empty" (bias to stay present).
        self.assertFalse(floor_looks_empty(100_000, None, 0.30, window_ready=True))
        self.assertFalse(floor_looks_empty(100_000, 0.0, 0.30, window_ready=True))

    def test_occupied_floor_is_not_empty(self):
        # Dual-occupancy rolling p20 ~2.5M vs learned occupied ~2.5M: well above
        # 30% => occupied. A genuine sleeper stays present.
        self.assertFalse(floor_looks_empty(2_500_000, 2_500_000, 0.30, window_ready=True))

    def test_crosstalk_floor_is_empty(self):
        # Crosstalk between-burst floor ~0.7M vs learned occupied ~2.5M: below
        # 30% (0.75M) => empty.
        self.assertTrue(floor_looks_empty(700_000, 2_500_000, 0.30, window_ready=True))

    def test_still_sleeper_dip_stays_safe(self):
        # The lowest genuine dual-occupancy sample observed on the recording was
        # ~0.87M against an occupied floor of ~2.5M (0.35x): above the 0.30
        # threshold, so a brief still dip does NOT read as empty.
        self.assertFalse(floor_looks_empty(870_000, 2_500_000, 0.30, window_ready=True))


class TestAmbiguousShouldAdvance(unittest.TestCase):
    def test_empty_floor_advances_immediately(self):
        self.assertTrue(ambiguous_should_advance(True, 1, 600, 4))

    def test_occupied_floor_freezes_within_cap(self):
        # Floor not empty and streak below cap => freeze (return False), exactly
        # the earlier behavior for a genuine sleeper.
        self.assertFalse(ambiguous_should_advance(False, 10, 600, 4))
        self.assertFalse(ambiguous_should_advance(False, 600, 600, 4))

    def test_backstop_leaks_after_cap(self):
        # Past the cap, advance ~1 tick in leak_divisor even with an
        # inconclusive floor -- nothing freezes forever.
        self.assertTrue(ambiguous_should_advance(False, 604, 600, 4))   # 604 % 4 == 0
        self.assertFalse(ambiguous_should_advance(False, 605, 600, 4))  # 605 % 4 != 0

    def test_backstop_can_be_disabled(self):
        # freeze_cap<=0 or leak_divisor<=0 disables the leak entirely.
        self.assertFalse(ambiguous_should_advance(False, 10_000, 0, 4))
        self.assertFalse(ambiguous_should_advance(False, 10_000, 600, 0))


class TestUpdateOccupiedFloorEst(unittest.TestCase):
    def test_seeds_on_first_sample(self):
        self.assertEqual(update_occupied_floor_est(None, 2_500_000, 0.02), 2_500_000.0)

    def test_slow_ema_barely_moves_on_one_sample(self):
        # A single low sample should not yank the reference down (that is what
        # protects the estimate from an occasional still frame).
        est = update_occupied_floor_est(2_500_000, 500_000, 0.02)
        self.assertAlmostEqual(est, 2_460_000.0)
        self.assertGreater(est, 2_400_000)

    def test_converges_toward_sustained_level(self):
        est = 2_500_000.0
        for _ in range(2000):
            est = update_occupied_floor_est(est, 2_000_000, 0.02)
        self.assertAlmostEqual(est, 2_000_000.0, delta=1_000)


if __name__ == '__main__':
    unittest.main()
