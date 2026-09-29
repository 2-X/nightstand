"""Re-analyzing a night replaces the records it overlaps.

Loads db.py under its own module name with sqlite3.connect pointed at an
in-memory database, so the stub 'db' modules other tests install in
sys.modules are neither used nor disturbed.
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
"""

NIGHT = datetime(2026, 9, 27, 23, 0, 0, tzinfo=timezone.utc)


def _load_db_module():
    real_connect = sqlite3.connect
    path = os.path.join(os.path.dirname(__file__), '..', 'db.py')
    spec = importlib.util.spec_from_file_location('db_under_test', path)
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


class InsertSleepRecordsTest(unittest.TestCase):
    def setUp(self):
        self.db = _load_db_module()
        self.db.conn.executescript(SCHEMA)

    def _rows(self):
        return self.db.conn.execute(
            'SELECT side, entered_bed_at, left_bed_at FROM sleep_records ORDER BY side, entered_bed_at'
        ).fetchall()

    def test_wider_window_replaces_truncated_record(self):
        truncated_start = NIGHT + timedelta(hours=1)
        self.db.insert_sleep_records([_record('right', truncated_start, 7)])
        self.db.insert_sleep_records([_record('right', NIGHT, 8)])
        self.assertEqual(self._rows(), [
            ('right', int(NIGHT.timestamp()), int((NIGHT + timedelta(hours=8)).timestamp())),
        ])

    def test_same_start_is_replaced_with_new_values(self):
        self.db.insert_sleep_records([_record('right', NIGHT, 6)])
        self.db.insert_sleep_records([_record('right', NIGHT, 8)])
        rows = self._rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][2], int((NIGHT + timedelta(hours=8)).timestamp()))

    def test_other_side_and_adjacent_nights_are_kept(self):
        self.db.insert_sleep_records([
            _record('left', NIGHT, 8),
            _record('right', NIGHT - timedelta(days=1), 8),
        ])
        self.db.insert_sleep_records([_record('right', NIGHT, 8)])
        self.assertEqual(len(self._rows()), 3)

    def test_touching_records_do_not_overlap(self):
        self.db.insert_sleep_records([_record('right', NIGHT - timedelta(hours=4), 4)])
        self.db.insert_sleep_records([_record('right', NIGHT, 8)])
        self.assertEqual(len(self._rows()), 2)

    def test_failed_insert_keeps_existing_records(self):
        self.db.insert_sleep_records([_record('right', NIGHT, 8)])
        broken = _record('right', NIGHT + timedelta(hours=1), 7)
        broken['sleep_period_seconds'] = None
        with unittest.mock.patch.object(self.db.logger, 'error') as logged:
            self.db.insert_sleep_records([broken])
        logged.assert_called_once()
        self.assertEqual(self._rows(), [
            ('right', int(NIGHT.timestamp()), int((NIGHT + timedelta(hours=8)).timestamp())),
        ])
        stored = self.db.conn.execute('SELECT present_intervals FROM sleep_records').fetchone()[0]
        self.assertEqual(len(json.loads(stored)), 1)


if __name__ == '__main__':
    unittest.main()
