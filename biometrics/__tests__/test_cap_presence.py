"""Tests for capacitance-sensor presence detection.

Root cause: create_cap_baseline_from_cap_df's min_std floor (previously a
hardcoded 5) is a lower bound on the per-sensor std used as a z-score
denominator in detect_presence_cap. That floor was tuned for older capSense
hardware, whose raw values run in the hundreds to low thousands. Pod 5's
capSense2 records get pair-averaged down to a much smaller scale (out/cen/in
typically 9-25; see load_raw_files._normalize_cap_sense2), where a real,
genuinely-empty-bed std measures well under 1. A floor of 5 dominated every
Pod 5 sensor's z-score denominator by two to three orders of magnitude,
suppressing real occupied-vs-empty deltas enough that cap_{side}_occupied
never crossed detect_presence_cap's occupancy_threshold: replaying a real
overnight RAW recording (both sides occupied about 8 hours,
confirmed ground truth) through the shipped pipeline showed cap presence
firing on 0.0-0.1% of confirmed-occupied samples on both sides, all night.

Lowering the default floor to 1 (still comfortably above the ~0.85 empty-bed
noise ceiling measured across three independent empty stretches in that same
recording) restored cap presence to ~90-99% of confirmed-occupied samples on
both sides, with 0% false positives across those same empty stretches.

These tests use small synthetic DataFrames (the real validation recording is local,
untracked file, not part of this repo) to pin down the floor's effect and
the correctness of detect_presence_cap's rolling-window math, independent of
any real hardware capture.

Run locally (needs pandas/numpy only -- this module does not import
scipy/db):
    python3 -m unittest biometrics.__tests__.test_cap_presence -v
(also runs under plain unittest discover, or pytest where available)
"""
import unittest

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'sleep_detection'))

import logging
import get_logger as _gl

_gl._get_file_handler = lambda data_folder_path, name: logging.NullHandler()

from get_logger import get_logger, LOGGER_NAMES

for _name in LOGGER_NAMES:
    get_logger(_name)

import pandas as pd

from cap_data import create_cap_baseline_from_cap_df, detect_presence_cap


def _make_cap_df(values_by_sensor, freq_seconds=1, start='2025-01-01 04:00:00'):
    """Build a DatetimeIndex DataFrame of {side}_out/{side}_cen/{side}_in
    columns from a dict of sensor -> list of values (all lists same length).
    """
    n = len(next(iter(values_by_sensor.values())))
    index = pd.date_range(start=start, periods=n, freq=f'{freq_seconds}s')
    df = pd.DataFrame(values_by_sensor, index=index)
    return df


class TestCreateCapBaselineFloor(unittest.TestCase):
    def test_default_floor_is_1_not_5(self):
        # Regression: the shipped default used to be 5, which was
        # measured to be 2-3 orders of magnitude above this hardware's real
        # noise scale. Pin the new default so a future edit can't silently
        # regress it back.
        df = _make_cap_df({
            'left_out': [11.6] * 300,
            'left_cen': [9.8] * 300,
            'left_in': [15.5] * 300,
        })
        baseline = create_cap_baseline_from_cap_df(df, df.index[0], df.index[-1], 'left')
        # Std of a constant series is 0, so the floor is the only thing
        # setting the value; a floor of 1 (not 5) proves the new default.
        self.assertEqual(baseline['left_out']['std'], 1)
        self.assertEqual(baseline['left_cen']['std'], 1)
        self.assertEqual(baseline['left_in']['std'], 1)

    def test_floor_only_engages_below_the_real_std(self):
        # Pod-5-scale noisy-but-real empty-bed data (std ~0.5, matching the
        # recording's measured empty-window std of 0.4-0.85): real std should
        # win over a floor of 1 once it's the larger value... use a series
        # with std clearly above 1 to check the floor doesn't clobber it.
        import itertools
        pattern = itertools.cycle([10.0, 12.0, 8.0, 14.0, 6.0])
        values = [next(pattern) for _ in range(300)]
        df = _make_cap_df({'left_out': values, 'left_cen': values, 'left_in': values})
        baseline = create_cap_baseline_from_cap_df(df, df.index[0], df.index[-1], 'left')
        real_std = pd.Series(values).std()
        self.assertGreater(real_std, 1)
        self.assertAlmostEqual(baseline['left_out']['std'], real_std, places=6)

    def test_explicit_min_std_still_overridable(self):
        df = _make_cap_df({
            'left_out': [11.6] * 300, 'left_cen': [9.8] * 300, 'left_in': [15.5] * 300,
        })
        baseline = create_cap_baseline_from_cap_df(df, df.index[0], df.index[-1], 'left', min_std=5)
        self.assertEqual(baseline['left_out']['std'], 5)


class TestDetectPresenceCapFloorBug(unittest.TestCase):
    """Reproduces the real occupied-bed shape at Pod-5 scale: a small, real
    occupied-vs-empty delta (mean shifts ~8-14 units, matching the recording's
    measured left_out/right_out deltas) against a baseline whose real std is
    tiny (~0.04, matching the recording's measured calibration-window std).
    """

    def setUp(self):
        self.baseline_mean = {'left_out': 11.6, 'left_cen': 9.8, 'left_in': 15.5}
        # Occupied-bed values elevated similarly to the recording's measured
        # deltas (e.g. left_out baseline ~11.6 -> occupied ~20-25).
        occupied_values = {
            'left_out': [21.0] * 60,
            'left_cen': [15.0] * 60,
            'left_in': [22.0] * 60,
        }
        self.occupied_df = _make_cap_df(occupied_values)

    def _baseline_with_floor(self, min_std):
        # A near-constant "empty bed" calibration window, like the real
        # recording's identified 5-minute baseline period (true std ~0.03-0.05).
        empty_values = {
            'left_out': [11.6, 11.61, 11.59, 11.6, 11.62] * 60,
            'left_cen': [9.8, 9.79, 9.81, 9.8, 9.78] * 60,
            'left_in': [15.5, 15.49, 15.51, 15.5, 15.52] * 60,
        }
        empty_df = _make_cap_df(empty_values)
        return create_cap_baseline_from_cap_df(empty_df, empty_df.index[0], empty_df.index[-1], 'left', min_std=min_std)

    def test_shipped_floor_of_5_never_detects_the_occupied_delta(self):
        # This is the bug as it shipped: min_std=5 swamps the real signal.
        baseline = self._baseline_with_floor(min_std=5)
        df = self.occupied_df.copy()
        detect_presence_cap(df, baseline, 'left', occupancy_threshold=5,
                            rolling_seconds=10, threshold_percent=0.90, clean=False)
        self.assertEqual(df['cap_left_occupied'].sum(), 0)

    def test_fixed_floor_of_1_detects_the_occupied_delta(self):
        baseline = self._baseline_with_floor(min_std=1)
        df = self.occupied_df.copy()
        detect_presence_cap(df, baseline, 'left', occupancy_threshold=5,
                            rolling_seconds=10, threshold_percent=0.90, clean=False)
        # Rolling window needs its warm-up (min_periods=1 still requires the
        # 90%-of-10 threshold_count to accumulate), but once warmed up it
        # should latch present for the whole sustained-occupied stretch.
        self.assertGreater(df['cap_left_occupied'].sum(), 0)
        self.assertEqual(df['cap_left_occupied'].iloc[-1], 1)

    def test_fixed_floor_does_not_false_fire_on_a_still_empty_bed(self):
        # Same near-constant shape as the calibration window itself, just a
        # different (still empty) stretch -- must not trip presence.
        baseline = self._baseline_with_floor(min_std=1)
        still_empty = _make_cap_df({
            'left_out': [11.58, 11.61, 11.6, 11.59, 11.62] * 60,
            'left_cen': [9.81, 9.79, 9.8, 9.82, 9.78] * 60,
            'left_in': [15.51, 15.49, 15.5, 15.52, 15.48] * 60,
        })
        detect_presence_cap(still_empty, baseline, 'left', occupancy_threshold=5,
                            rolling_seconds=10, threshold_percent=0.90, clean=False)
        self.assertEqual(still_empty['cap_left_occupied'].sum(), 0)


if __name__ == '__main__':
    unittest.main()
