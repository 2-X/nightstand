"""v2 rows keep their precision and new columns; legacy rows and readers are unchanged."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.dirname(__file__))

import migrated_db
from vitals2.rows import HrvEstimate, WindowEstimate, minute_row

MINUTE = 1_790_600_400
COLUMNS = ('side, timestamp, heart_rate, hrv, breathing_rate, hr_quality, rmssd, sdnn, '
           'hrv_coverage, resp_rate, resp_quality, estimator')


def v2_row(minute=MINUTE, rate=104.4):
    return minute_row('left', minute, [WindowEstimate(minute + 5 * index, rate, 0.8) for index in range(4)],
                      [WindowEstimate(minute, 16.24, 0.9)], HrvEstimate(minute + 60, 41.26, 38.74, 0.812))


class InsertVitalsV2Test(unittest.TestCase):
    def setUp(self):
        self.db = migrated_db.load_db_module('db_for_v2_insert')
        self.conn = self.db.conn

    def test_v2_rows_are_stored_as_given(self):
        self.db.insert_vitals(v2_row())
        self.assertEqual(self.conn.execute(f'SELECT {COLUMNS} FROM vitals').fetchone(),
                         ('left', MINUTE, 104.0, 39.0, 16.0, 0.8, 41.3, 38.7, 0.81, 16.2, 0.9, 2))

    def test_a_repeated_minute_is_skipped(self):
        self.db.insert_vitals(v2_row())
        self.db.insert_vitals(v2_row(rate=70.0))
        self.assertEqual(self.conn.execute('SELECT count(*), max(heart_rate) FROM vitals').fetchone(), (1, 104.0))

    def test_legacy_rows_are_still_floored(self):
        self.db.insert_vitals({'side': 'left', 'timestamp': MINUTE, 'heart_rate': 62.7, 'hrv': 44.9,
                               'breathing_rate': float('nan')})
        self.assertEqual(self.conn.execute(f'SELECT {COLUMNS} FROM vitals').fetchone(),
                         ('left', MINUTE, 62.0, 44.0, 0.0, None, None, None, None, None, None, None))

    def test_older_readers_get_legacy_semantics(self):
        self.db.insert_vitals({'side': 'left', 'timestamp': MINUTE - 60, 'heart_rate': 61.0, 'hrv': 45.0,
                               'breathing_rate': 13.0})
        self.db.insert_vitals(v2_row(rate=62.2))
        rows = self.conn.execute('SELECT heart_rate, hrv, breathing_rate FROM vitals ORDER BY timestamp').fetchall()
        for heart_rate, hrv, breathing_rate in rows:
            self.assertEqual(heart_rate, int(heart_rate))
            self.assertTrue(hrv == int(hrv) and 0 <= hrv <= 200)
            self.assertTrue(breathing_rate == int(breathing_rate) and 0 <= breathing_rate <= 30)
        # The averages a 3.4.0 server computes for the summary and the score.
        self.assertEqual(self.conn.execute(
            'SELECT avg(hrv) FROM vitals WHERE hrv != 0 AND hrv BETWEEN 30 AND 120').fetchone(), (42.0,))
        self.assertEqual(self.conn.execute(
            'SELECT avg(breathing_rate) FROM vitals WHERE breathing_rate != 0 AND breathing_rate BETWEEN 5 AND 20'
        ).fetchone(), (14.5,))
        self.assertEqual(self.conn.execute('SELECT min(heart_rate) FROM vitals').fetchone(), (61.0,))


if __name__ == '__main__':
    unittest.main()
