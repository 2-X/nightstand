"""Tests for the p98-p2 offline presence detector.

The offline sleep analyzer's original piezo presence detector thresholded
second-to-second drift of the per-second signal MEAN (a DC offset), which
false-fired on pump cycling with an empty bed and carried no within-second
amplitude information. `detect_presence_piezo_p2p` instead thresholds the
per-second p98-p2 waveform range (the same quantity the live stream uses) with
the live pipeline's 150k noise floor.

Run on the pod (venv has numpy/pandas; the local Mac python may lack them):
    python3 -m unittest __tests__.test_piezo_p2p -v
"""
import unittest

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import logging
import get_logger as _gl

_gl._get_file_handler = lambda data_folder_path, name: logging.NullHandler()

# piezo_data calls the nameless get_logger(), which needs a named logger to
# exist first (same setup as test_load_raw_files / test_stream_helpers).
from get_logger import get_logger, LOGGER_NAMES

for _name in LOGGER_NAMES:
    get_logger(_name)

import numpy as np
import pandas as pd

from piezo_data import _calculate_p2p, detect_presence_piezo_p2p, load_piezo_df


def _second_index(n):
    """A DatetimeIndex of n consecutive 1-second timestamps."""
    return pd.date_range('2026-07-09 04:15:00', periods=n, freq='1s', name='ts')


class TestCalculateP2P(unittest.TestCase):
    def test_exact_value_on_known_array(self):
        # Hand-built int32 array 0..999: a dtype-handling regression would move
        # this away from the expected np.percentile result.
        arr = np.arange(1000, dtype=np.int32)
        expected = float(np.percentile(arr.astype(np.int64), 98) - np.percentile(arr.astype(np.int64), 2))
        self.assertAlmostEqual(_calculate_p2p(arr), expected, places=6)
        # ~979.02 - 19.98 == 959.04 (sanity anchor, independent of the line above)
        self.assertAlmostEqual(_calculate_p2p(arr), 959.04, places=2)

    def test_outlier_robustness(self):
        # Flat signal with two int32-max spikes: max-min would explode to ~2.1e9,
        # but p98 ignores the top ~2% so the range stays ~0. This is the whole
        # reason p98-p2 is used instead of max-min.
        arr = np.full(1000, 1000, dtype=np.int32)
        arr[0] = np.iinfo(np.int32).max
        arr[1] = np.iinfo(np.int32).max
        self.assertLess(_calculate_p2p(arr), 1.0)


class TestDetectPresencePiezoP2P(unittest.TestCase):
    def _df(self, p2p_values, side='left'):
        n = len(p2p_values)
        df = pd.DataFrame({f'{side}1_p2p': p2p_values, f'{side}1_avg': np.zeros(n)},
                          index=_second_index(n))
        return df

    def test_empty_bed_all_absent(self):
        # Empty-bed idle p2p (40k-120k) sits below the 150k noise floor.
        rng = np.linspace(40_000, 120_000, 120)
        df = self._df(rng)
        detect_presence_piezo_p2p(df, 'left')
        self.assertEqual(df['piezo_left1_presence'].sum(), 0)

    def test_occupied_present_after_warmup(self):
        # Occupancy drives p2p to 0.5M-5M, well above the floor.
        vals = np.linspace(500_000, 5_000_000, 120)
        df = self._df(vals)
        detect_presence_piezo_p2p(df, 'left')
        presence = df['piezo_left1_presence'].to_numpy()
        # 7-of-10 debounce: present by the time the window fills, and stays present.
        self.assertEqual(presence[0], 0)
        self.assertEqual(presence[-1], 1)
        self.assertEqual(presence[10:].sum(), len(presence) - 10)

    def test_single_second_spike_absorbed(self):
        # A lone 10M spike in an otherwise sub-threshold series must not register
        # presence: one hot second can never reach the 7-of-10 rolling count.
        vals = np.full(120, 80_000.0)
        vals[60] = 10_000_000.0
        df = self._df(vals)
        detect_presence_piezo_p2p(df, 'left')
        self.assertEqual(df['piezo_left1_presence'].sum(), 0)

    def test_clean_drops_intermediate_columns(self):
        df = self._df(np.full(30, 80_000.0))
        detect_presence_piezo_p2p(df, 'left', clean=True)
        self.assertNotIn('left1_p2p', df.columns)
        self.assertNotIn('left1_avg', df.columns)
        self.assertIn('piezo_left1_presence', df.columns)


class TestLoadPiezoDfWithP2P(unittest.TestCase):
    def _raw_rows(self, side='left', n=50):
        """Synthetic decoded piezo_dual rows, shaped like load_raw_files output."""
        rows = []
        base = pd.Timestamp('2026-07-09 04:15:00')
        for i in range(n):
            arr = np.arange(1000, dtype=np.int32) + i  # nonzero p98-p2, varying avg
            rows.append({
                'ts': (base + pd.Timedelta(seconds=i)).strftime('%Y-%m-%d %H:%M:%S'),
                f'{side}1': arr,
                'type': 'piezo-dual',
                'freq': 500,
                'adc': 1,
                'gain': 400,
            })
        return {'piezo_dual': rows}

    def test_with_p2p_true_adds_column_and_drops_raw(self):
        df = load_piezo_df(self._raw_rows(), 'left', with_p2p=True)
        self.assertIn('left1_p2p', df.columns)
        self.assertNotIn('left1', df.columns)  # raw array column dropped
        self.assertTrue((df['left1_p2p'] > 0).all())

    def test_with_p2p_false_is_default_and_omits_column(self):
        df = load_piezo_df(self._raw_rows(), 'left')
        self.assertNotIn('left1_p2p', df.columns)
        self.assertNotIn('left1', df.columns)
        self.assertIn('left1_avg', df.columns)


if __name__ == '__main__':
    unittest.main()
