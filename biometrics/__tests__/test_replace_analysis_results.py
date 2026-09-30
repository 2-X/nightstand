"""One analyzer run writes its sleep records and movement together.

Loads db.py under its own module name with sqlite3.connect pointed at an
in-memory database, so stub 'db' modules other tests install are neither used
nor disturbed.
"""
import importlib.util
import json
import logging
import os
import sqlite3
import sys
import unittest
import unittest.mock
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import get_logger as gl

gl._get_file_handler = lambda *args: logging.NullHandler()
for name in gl.LOGGER_NAMES:
    gl.get_logger(name)

SCHEMA = """
CREATE TABLE sleep_records (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    side TEXT NOT NULL,
    entered_bed_at INTEGER NOT NULL,
    left_bed_at INTEGER NOT NULL,
    sleep_period_seconds INTEGER NOT NULL,
    times_exited_bed INTEGER NOT NULL,
    present_intervals TEXT NOT NULL,
    not_present_intervals TEXT NOT NULL
);
CREATE UNIQUE INDEX sleep_records_side_entered_bed_at_key ON sleep_records (side, entered_bed_at);
CREATE TABLE movement (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    side TEXT NOT NULL,
    total_movement INTEGER NOT NULL
);
CREATE UNIQUE INDEX movement_side_timestamp_key ON movement (side, timestamp);
"""

NIGHT = datetime(2026, 9, 27, 23, 0, 0, tzinfo=timezone.utc)
BINS = int((NIGHT - timedelta(hours=11)).timestamp())


def _load_db_module():
    real_connect = sqlite3.connect
    path = os.path.join(os.path.dirname(__file__), '..', 'db.py')
    spec = importlib.util.spec_from_file_location('db_under_test_replace', path)
    module = importlib.util.module_from_spec(spec)
    with unittest.mock.patch('sqlite3.connect', lambda *a, **k: real_connect(':memory:', isolation_level=None)):
        spec.loader.exec_module(module)
    return module


def _record(side, entered, hours):
    left = entered + timedelta(hours=hours)
    return {
        'side': side,
        'entered_bed_at': entered,
        'left_bed_at': left,
        'sleep_period_seconds': int((left - entered).total_seconds()),
        'times_exited_bed': 0,
        'present_intervals': [(entered, left)],
        'not_present_intervals': [],
    }


class ReplaceAnalysisResultsTest(unittest.TestCase):
    def setUp(self):
        self.db = _load_db_module()
        self.db.conn.executescript(SCHEMA)

    def _write(self, side, records, movement=(), window=None):
        start, end = window or (NIGHT - timedelta(hours=12), NIGHT + timedelta(hours=24))
        return self.db.replace_analysis_results(
            side, records, list(movement), int(start.timestamp()), int(end.timestamp()))

    def _records(self):
        return self.db.conn.execute(
            'SELECT side, entered_bed_at, left_bed_at FROM sleep_records ORDER BY side, entered_bed_at'
        ).fetchall()

    def _movement(self):
        return self.db.conn.execute(
            'SELECT side, timestamp, total_movement FROM movement ORDER BY side, timestamp'
        ).fetchall()

    def test_wider_window_replaces_truncated_record(self):
        self._write('right', [_record('right', NIGHT + timedelta(hours=1), 7)])
        self._write('right', [_record('right', NIGHT, 8)])
        self.assertEqual(self._records(), [
            ('right', int(NIGHT.timestamp()), int((NIGHT + timedelta(hours=8)).timestamp())),
        ])

    def test_same_start_is_replaced_with_new_values(self):
        self._write('right', [_record('right', NIGHT, 6)])
        self._write('right', [_record('right', NIGHT, 8)])
        rows = self._records()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][2], int((NIGHT + timedelta(hours=8)).timestamp()))

    def test_other_side_and_adjacent_nights_are_kept(self):
        self._write('left', [_record('left', NIGHT, 8)])
        self._write('right', [_record('right', NIGHT - timedelta(days=1), 8)])
        self._write('right', [_record('right', NIGHT, 8)])
        self.assertEqual(len(self._records()), 3)

    def test_touching_records_do_not_overlap(self):
        self._write('right', [_record('right', NIGHT - timedelta(hours=4), 4)])
        self._write('right', [_record('right', NIGHT, 8)])
        self.assertEqual(len(self._records()), 2)

    def test_failed_record_keeps_existing_rows_and_raises(self):
        self._write('right', [_record('right', NIGHT, 8)])
        broken = _record('right', NIGHT + timedelta(hours=1), 7)
        broken['sleep_period_seconds'] = None
        with self.assertRaises(sqlite3.IntegrityError):
            self._write('right', [broken])
        self.assertEqual(self._records(), [
            ('right', int(NIGHT.timestamp()), int((NIGHT + timedelta(hours=8)).timestamp())),
        ])
        stored = self.db.conn.execute('SELECT present_intervals FROM sleep_records').fetchone()[0]
        self.assertEqual(len(json.loads(stored)), 1)

    def test_rerun_overwrites_the_bins_it_recomputes_and_keeps_the_rest(self):
        # A shorter window than the run that stored these must not erase them.
        self.db.conn.executemany(
            'INSERT INTO movement (side, timestamp, total_movement) VALUES (?, ?, ?)',
            [('left', BINS - 600, 9.0), ('left', BINS + 120, 5.0), ('left', BINS + 240, 6.0),
             ('left', BINS + 360, 4.0), ('right', BINS + 120, 7.0), ('left', BINS + 90_000, 8.0)],
        )
        self._write('left', [], [(BINS + 120, 0.4), (BINS + 240, 0.6)])
        self.assertEqual(self._movement(), [
            ('left', BINS - 600, 9),
            ('left', BINS + 120, 0.4),
            ('left', BINS + 240, 0.6),
            ('left', BINS + 360, 4),
            ('left', BINS + 90_000, 8),
            ('right', BINS + 120, 7),
        ])

    def test_run_without_movement_keeps_stored_movement(self):
        self.db.conn.execute('INSERT INTO movement (side, timestamp, total_movement) VALUES (?, ?, ?)',
                             ('left', BINS + 60, 3.5))
        self._write('left', [_record('left', NIGHT, 8)], [])
        self.assertEqual(self._movement(), [('left', BINS + 60, 3.5)])

    def test_movement_failure_rolls_back_the_sleep_records(self):
        self._write('right', [_record('right', NIGHT, 8)], [(BINS + 60, 1.5)])
        with self.assertRaises(TypeError):
            self._write('right', [_record('right', NIGHT + timedelta(hours=1), 7)], [(BINS + 60, None)])
        self.assertEqual(self._records(), [
            ('right', int(NIGHT.timestamp()), int((NIGHT + timedelta(hours=8)).timestamp())),
        ])
        self.assertEqual(self._movement(), [('right', BINS + 60, 1.5)])

    def test_run_that_saw_only_part_of_a_stored_night_keeps_the_stored_record(self):
        stored_start = NIGHT - timedelta(hours=1, minutes=30)
        self._write('right', [_record('right', stored_start, 9.5)])
        window = (NIGHT - timedelta(hours=1), NIGHT + timedelta(hours=10))
        written = self._write('right', [_record('right', NIGHT - timedelta(hours=1), 8.0)], window=window)
        self.assertEqual(written, (0, 0))
        self.assertEqual(self._records(), [
            ('right', int(stored_start.timestamp()), int((stored_start + timedelta(hours=9.5)).timestamp())),
        ])

    def test_run_whose_window_covers_the_stored_record_replaces_it(self):
        stored_start = NIGHT - timedelta(hours=1, minutes=30)
        self._write('right', [_record('right', stored_start, 9.5)])
        window = (NIGHT - timedelta(hours=2), NIGHT + timedelta(hours=10))
        written = self._write('right', [_record('right', NIGHT - timedelta(hours=1), 8.0)], window=window)
        self.assertEqual(written, (1, 0))
        self.assertEqual(self._records(), [
            ('right', int((NIGHT - timedelta(hours=1)).timestamp()), int((NIGHT + timedelta(hours=7)).timestamp())),
        ])

    def test_stored_record_exactly_on_the_window_edges_is_replaced(self):
        self._write('right', [_record('right', NIGHT, 6)])
        window = (NIGHT, NIGHT + timedelta(hours=6))
        self._write('right', [_record('right', NIGHT + timedelta(hours=1), 4)], window=window)
        self.assertEqual(self._records(), [
            ('right', int((NIGHT + timedelta(hours=1)).timestamp()), int((NIGHT + timedelta(hours=5)).timestamp())),
        ])

    def test_a_kept_record_does_not_stop_a_separate_new_record(self):
        stored_start = NIGHT - timedelta(hours=1)
        self._write('right', [_record('right', stored_start, 8)])
        later = NIGHT + timedelta(days=1)
        window = (NIGHT, later + timedelta(hours=8))
        written = self._write('right', [_record('right', NIGHT, 7), _record('right', later, 8)], window=window)
        self.assertEqual(written, (1, 0))
        self.assertEqual([row[1] for row in self._records()], [int(stored_start.timestamp()), int(later.timestamp())])

    def test_a_record_for_the_other_side_is_refused_before_anything_is_written(self):
        with self.assertRaises(ValueError):
            self._write('left', [_record('left', NIGHT, 8), _record('right', NIGHT + timedelta(days=1), 8)],
                        [(BINS, 1.5)])
        self.assertEqual(self._records(), [])
        self.assertEqual(self._movement(), [])

    def test_an_empty_call_writes_nothing(self):
        self.assertEqual(self._write('left', []), (0, 0))
        self.assertEqual(self._records(), [])
        self.assertEqual(self._movement(), [])

    def test_returns_what_it_wrote(self):
        written = self._write('left', [_record('left', NIGHT, 8)], [(BINS, 1.5), (BINS + 120, 2.5)])
        self.assertEqual(written, (1, 2))


if __name__ == '__main__':
    unittest.main()
