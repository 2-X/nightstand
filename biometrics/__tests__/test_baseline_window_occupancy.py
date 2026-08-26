"""The baseline window must be empty on BOTH sides, not just its own.

`identify_baseline_period` looked only at its own side's range and capacitive
stability. The run-time occupancy guard is whole-bed but asks about NOW, while
the window is chosen from the preceding six hours, so a side could learn its
"empty bed" floor from a stretch where the partner was in bed. That is not
hypothetical: one night's left-side window contained two of the right side's
vitals readings, and the left's measured tail rose 8x while its median held.

Run on the pod (venv has numpy/pandas; the local Mac python may lack them):
    python3 -m unittest __tests__.test_baseline_window_occupancy -v
"""
import unittest

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import logging
import get_logger as _gl

_gl._get_file_handler = lambda data_folder_path, name: logging.NullHandler()

from get_logger import get_logger, LOGGER_NAMES

for _name in LOGGER_NAMES:
    get_logger(_name)

import numpy as np
import pandas as pd

from piezo_data import identify_baseline_period


def _frame(minutes=30, start='2026-08-25 19:00:00'):
    """A calm frame where every window would otherwise qualify."""
    n = minutes * 60
    idx = pd.date_range(start, periods=n, freq='1s', name='ts')
    df = pd.DataFrame(index=idx)
    df['left1_range'] = 1_000.0
    for col in ('left_out', 'left_cen', 'left_in'):
        df[col] = 100.0
    return df


def _epoch(ts):
    return int(pd.Timestamp(ts).timestamp())


class TestWindowRejectsOccupiedStretches(unittest.TestCase):
    def test_without_the_guard_the_first_window_wins(self):
        # Baseline behaviour, so the tests below isolate the guard's effect.
        start, end = identify_baseline_period(_frame(), 'left', empty_minutes=5)
        self.assertEqual(start, pd.Timestamp('2026-08-25 19:00:00'))
        self.assertEqual(end, pd.Timestamp('2026-08-25 19:05:00'))

    def test_a_window_holding_the_partners_vitals_is_rejected(self):
        # The real case: someone on the other side during this side's window.
        occupied = [_epoch('2026-08-25 19:03:00')]
        start, _ = identify_baseline_period(
            _frame(), 'left', empty_minutes=5, occupied_seconds=occupied,
        )
        self.assertIsNotNone(start, 'a later clean window exists and should be used')
        self.assertGreater(start, pd.Timestamp('2026-08-25 19:03:00'))

    def test_it_keeps_searching_and_finds_the_clean_window(self):
        # Occupied for the first 10 minutes, clean afterwards.
        occupied = [
            _epoch('2026-08-25 19:00:00') + s for s in range(0, 600, 30)
        ]
        start, end = identify_baseline_period(
            _frame(), 'left', empty_minutes=5, occupied_seconds=occupied,
        )
        self.assertIsNotNone(start)
        self.assertGreaterEqual(start, pd.Timestamp('2026-08-25 19:09:30'))
        self.assertEqual((end - start), pd.Timedelta(minutes=5))

    def test_an_entirely_occupied_load_yields_no_window(self):
        # Skipping is the correct outcome. Calibrating against an occupied bed
        # is the failure this guard exists to prevent, so finding nothing must
        # not fall back to picking something.
        frame = _frame()
        # Every second, not a sample of them: windows at the tail of the load
        # extend past the last row, so a sparse list leaves a gap there.
        occupied = [_epoch(ts) for ts in frame.index]
        start, end = identify_baseline_period(
            frame, 'left', empty_minutes=5, occupied_seconds=occupied,
        )
        self.assertIsNone(start)
        self.assertIsNone(end)

    def test_occupancy_outside_the_window_does_not_reject_it(self):
        # Only overlap matters. Rejecting on nearby-but-outside readings would
        # throw away usable windows on a night with any occupancy at all.
        occupied = [_epoch('2026-08-25 19:20:00')]
        start, _ = identify_baseline_period(
            _frame(), 'left', empty_minutes=5, occupied_seconds=occupied,
        )
        self.assertEqual(start, pd.Timestamp('2026-08-25 19:00:00'))

    def test_an_empty_occupancy_list_behaves_like_no_guard(self):
        # A night with no vitals at all is the common case, not a special one.
        start, _ = identify_baseline_period(
            _frame(), 'left', empty_minutes=5, occupied_seconds=[],
        )
        self.assertEqual(start, pd.Timestamp('2026-08-25 19:00:00'))

    def test_the_guard_survives_unsorted_input(self):
        # The lookup bisects, so an unsorted list would silently miss hits.
        occupied = [
            _epoch('2026-08-25 19:20:00'),
            _epoch('2026-08-25 19:02:00'),
            _epoch('2026-08-25 19:11:00'),
        ]
        start, _ = identify_baseline_period(
            _frame(), 'left', empty_minutes=5, occupied_seconds=occupied,
        )
        self.assertIsNotNone(start)
        for bad in occupied:
            self.assertFalse(
                start <= pd.Timestamp(bad, unit='s') < start + pd.Timedelta(minutes=5),
                'chosen window still contains an occupied second',
            )


if __name__ == '__main__':
    unittest.main()
