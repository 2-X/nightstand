"""Tests for the learned per-side empty-bed piezo floor.

The floor is measured over the confirmed-empty window the calibration run
already identifies, and stored. Nothing reads it yet, so the value of these
tests is entirely in pinning HOW it is measured: which quantity, which
percentile, and what happens when the window is unusable. Those are the
decisions a later consumer will inherit without being able to see them.

Run on the pod (venv has numpy/pandas; the local Mac python may lack them):
    python3 -m unittest __tests__.test_piezo_floor -v
"""
import unittest

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import logging
import get_logger as _gl

_gl._get_file_handler = lambda data_folder_path, name: logging.NullHandler()

# piezo_data calls the nameless get_logger(), which needs a named logger to
# exist first (same setup as test_piezo_p2p / test_load_raw_files).
from get_logger import get_logger, LOGGER_NAMES

for _name in LOGGER_NAMES:
    get_logger(_name)

import numpy as np
import pandas as pd

from insufficient_data import InsufficientDataError
from piezo_data import FLOOR_PERCENTILE, summarize_empty_floor


class TestSummarizeEmptyFloor(unittest.TestCase):
    def test_exact_values_on_a_known_series(self):
        # 0..99 makes every reported statistic checkable by hand, so a change
        # of percentile method or dtype shows up here rather than silently
        # shifting a floor that nothing is yet watching.
        summary = summarize_empty_floor(np.arange(100, dtype=np.float64))

        self.assertEqual(summary['samples'], 100)
        self.assertAlmostEqual(summary['min'], 0.0)
        self.assertAlmostEqual(summary['max'], 99.0)
        self.assertAlmostEqual(summary['mean'], 49.5)
        self.assertAlmostEqual(summary['percentiles']['p50'], 49.5)
        self.assertAlmostEqual(summary['percentiles']['p95'], 94.05)

    def test_the_floor_is_the_recorded_percentile_not_the_max(self):
        # The whole reason for a percentile: one glitch in a five minute
        # window must not become tomorrow's floor.
        values = np.concatenate([np.full(299, 100_000.0), [16_777_215.0]])
        summary = summarize_empty_floor(values)

        self.assertAlmostEqual(summary['floor'], 100_000.0)
        self.assertAlmostEqual(summary['max'], 16_777_215.0)

    def test_the_payload_records_which_percentile_produced_the_floor(self):
        # A floor stored without the rule that made it cannot be compared
        # against one measured after that rule changes.
        summary = summarize_empty_floor(np.arange(100, dtype=np.float64))

        self.assertEqual(summary['floor_percentile'], FLOOR_PERCENTILE)
        self.assertAlmostEqual(
            summary['floor'],
            summary['percentiles'][f'p{FLOOR_PERCENTILE}'],
        )

    def test_non_finite_samples_are_dropped_rather_than_poisoning_the_floor(self):
        # A single NaN anywhere in the window makes every numpy percentile NaN,
        # which would store a floor of null and read as "measured" downstream.
        values = pd.Series([100.0, np.nan, 200.0, np.inf, 300.0])
        summary = summarize_empty_floor(values)

        self.assertEqual(summary['samples'], 3)
        self.assertTrue(np.isfinite(summary['floor']))

    def test_an_empty_window_is_insufficient_data_not_a_failure(self):
        # Same posture the rest of calibration takes: nothing to measure yet
        # is a waiting state, not a broken pod.
        with self.assertRaises(InsufficientDataError):
            summarize_empty_floor(np.array([], dtype=np.float64))

    def test_an_all_nan_window_is_insufficient_data_too(self):
        with self.assertRaises(InsufficientDataError):
            summarize_empty_floor(np.array([np.nan, np.nan]))

    def test_every_stored_value_is_a_plain_float_so_json_can_hold_it(self):
        # save_profile json.dumps() the payload, and numpy scalars are not
        # JSON serializable. This fails at write time on the pod, nightly,
        # long after anyone is looking.
        summary = summarize_empty_floor(pd.Series([1.0, 2.0, 3.0]))

        for key in ('floor', 'min', 'max', 'mean', 'std'):
            self.assertIsInstance(summary[key], float, key)
        for key, value in summary['percentiles'].items():
            self.assertIsInstance(value, float, key)
        self.assertIsInstance(summary['samples'], int)


class TestCalibratorMeasuresTheRightQuantity(unittest.TestCase):
    """The floor is only comparable to the live gate if it is the same metric.

    The live entry gate and the offline p2p detector both threshold the
    within-second p98-p2 range. load_piezo_df only computes that column when
    asked. If the calibrator stops asking, the column disappears, the piezo
    step fails every night, and the cap calibration it sits behind keeps
    succeeding, so nothing looks wrong.
    """

    def setUp(self):
        source_path = os.path.join(
            os.path.dirname(__file__), '..', 'sleep_detection',
            'calibrate_sensor_thresholds.py',
        )
        with open(source_path, 'r') as handle:
            self.source = handle.read()

    def test_the_calibrator_asks_load_piezo_df_for_the_p2p_column(self):
        self.assertIn('with_p2p=True', self.source)

    def test_the_calibrator_stores_the_floor_under_its_own_sensor_type(self):
        # A 'piezo' profile sits beside the 'cap' one under the unique index
        # on (side, sensor_type). Writing it as 'cap' would overwrite the
        # capacitive baseline the presence detector depends on.
        self.assertIn("SENSOR_TYPE_PIEZO", self.source)


if __name__ == '__main__':
    unittest.main()
