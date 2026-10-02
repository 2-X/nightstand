"""The vitals table gains nullable columns without changing what older code reads or writes."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

import migrated_db

# The statement every earlier stream release uses to write a row.
LEGACY_INSERT = """
INSERT INTO vitals (side, timestamp, heart_rate, hrv, breathing_rate)
VALUES (:side, :timestamp, :heart_rate, :hrv, :breathing_rate)
ON CONFLICT(side, timestamp) DO NOTHING;
"""
NEW_COLUMNS = ('hr_quality', 'rmssd', 'sdnn', 'hrv_coverage', 'resp_rate', 'resp_quality', 'estimator')
LEGACY_ROW = {'side': 'left', 'timestamp': 1_790_600_400, 'heart_rate': 61, 'hrv': 44, 'breathing_rate': 13}


class VitalsSchemaCompatTest(unittest.TestCase):
    def setUp(self):
        self.conn = migrated_db.load_db_module().conn

    def test_new_columns_are_nullable_with_the_contract_types(self):
        columns = {row[1]: (row[2], row[3], row[4]) for row in self.conn.execute('PRAGMA table_info(vitals)')}
        for name in NEW_COLUMNS[:-1]:
            self.assertEqual(columns[name], ('REAL', 0, None), name)
        self.assertEqual(columns['estimator'], ('INTEGER', 0, None))
        for name in ('heart_rate', 'hrv', 'breathing_rate'):
            self.assertEqual(columns[name], ('REAL', 0, None), name)

    def test_older_writers_still_insert_and_leave_the_new_columns_empty(self):
        self.conn.execute(LEGACY_INSERT, LEGACY_ROW)
        row = self.conn.execute(f'SELECT {", ".join(NEW_COLUMNS)} FROM vitals').fetchone()
        self.assertEqual(row, (None,) * len(NEW_COLUMNS))

    def test_older_readers_see_the_same_columns(self):
        self.conn.execute(LEGACY_INSERT, LEGACY_ROW)
        self.assertEqual(
            self.conn.execute('SELECT id, side, timestamp, heart_rate, hrv, breathing_rate FROM vitals').fetchall(),
            [(1, 'left', 1_790_600_400, 61.0, 44.0, 13.0)],
        )


if __name__ == '__main__':
    unittest.main()
