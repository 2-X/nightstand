"""Tests for the calibration store accessors.

Run on the pod venv (no pytest there):
    /home/dac/venv/bin/python -m unittest __tests__.test_calibration -v
"""
import unittest
import sqlite3
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import logging
import get_logger as _gl

_gl._get_file_handler = lambda data_folder_path, name: logging.NullHandler()

from get_logger import get_logger, LOGGER_NAMES

for _name in LOGGER_NAMES:
    get_logger(_name)

import calibration


SCHEMA = """
CREATE TABLE calibration_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    side TEXT NOT NULL,
    sensor_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    quality REAL NOT NULL,
    source_start INTEGER NOT NULL,
    source_end INTEGER NOT NULL,
    samples_used INTEGER NOT NULL,
    run_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_profiles ON calibration_profiles (side, sensor_type);
CREATE TABLE calibration_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    side TEXT NOT NULL,
    sensor_type TEXT NOT NULL,
    status TEXT NOT NULL,
    trigger TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    quality REAL,
    message TEXT
);
"""


class CalibrationStoreTest(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        self.conn.executescript(SCHEMA)

    def tearDown(self):
        self.conn.close()

    def test_absent_profile_returns_none_rather_than_raising(self):
        # A fresh install has never calibrated. That is a normal state.
        self.assertIsNone(calibration.get_profile('left', 'cap', conn=self.conn))

    def test_defaults_cover_every_sensor_type_we_read(self):
        self.assertIn('cap', calibration.DEFAULTS)

    def test_save_then_get_round_trips_the_payload_and_provenance(self):
        run_id = calibration.record_run(
            'left', 'cap', calibration.STATUS_SUCCESS, calibration.TRIGGER_DAILY,
            started_at=1000, duration_ms=250, quality=0.8, conn=self.conn,
        )
        calibration.save_profile(
            'left', 'cap', {'left_out': {'mean': 12.5, 'std': 1.0}},
            quality=0.8, source_start=100, source_end=1900,
            samples_used=1800, run_id=run_id, conn=self.conn,
        )

        profile = calibration.get_profile('left', 'cap', conn=self.conn)
        self.assertEqual(profile['payload']['left_out']['mean'], 12.5)
        self.assertEqual(profile['quality'], 0.8)
        self.assertEqual(profile['samples_used'], 1800)

    def test_saving_twice_replaces_rather_than_duplicates(self):
        # The unique index is what "exactly one active profile" means.
        for mean in (1.0, 2.0):
            run_id = calibration.record_run(
                'left', 'cap', calibration.STATUS_SUCCESS, calibration.TRIGGER_DAILY,
                started_at=1000, duration_ms=10, quality=0.5, conn=self.conn,
            )
            calibration.save_profile(
                'left', 'cap', {'left_out': {'mean': mean, 'std': 1.0}},
                quality=0.5, source_start=1, source_end=2, samples_used=1,
                run_id=run_id, conn=self.conn,
            )

        rows = self.conn.execute('SELECT COUNT(*) FROM calibration_profiles').fetchone()[0]
        self.assertEqual(rows, 1)
        self.assertEqual(
            calibration.get_profile('left', 'cap', conn=self.conn)['payload']['left_out']['mean'],
            2.0,
        )

    def test_a_failed_run_does_not_disturb_the_active_profile(self):
        # This is the whole reason profiles and runs are separate tables.
        run_id = calibration.record_run(
            'left', 'cap', calibration.STATUS_SUCCESS, calibration.TRIGGER_DAILY,
            started_at=1, duration_ms=1, quality=0.9, conn=self.conn,
        )
        calibration.save_profile(
            'left', 'cap', {'left_out': {'mean': 5.0, 'std': 1.0}},
            quality=0.9, source_start=1, source_end=2, samples_used=1,
            run_id=run_id, conn=self.conn,
        )
        calibration.record_run(
            'left', 'cap', calibration.STATUS_FAILED, calibration.TRIGGER_DAILY,
            started_at=2, duration_ms=1, message='franken down', conn=self.conn,
        )

        profile = calibration.get_profile('left', 'cap', conn=self.conn)
        self.assertEqual(profile['payload']['left_out']['mean'], 5.0)

    def test_skipped_occupied_is_its_own_status(self):
        # A skip is the guard working, not the job breaking. Reporting the two
        # through one channel has already sent us chasing a phantom failure.
        calibration.record_run(
            'left', 'cap', calibration.STATUS_SKIPPED_OCCUPIED, calibration.TRIGGER_DAILY,
            started_at=1, duration_ms=1, message='bed occupied', conn=self.conn,
        )
        status = self.conn.execute('SELECT status FROM calibration_runs').fetchone()[0]
        self.assertEqual(status, 'skipped_occupied')
        self.assertNotEqual(status, calibration.STATUS_FAILED)

    def test_quality_rewards_a_longer_empty_window(self):
        short = calibration.compute_quality(300, 300, 300)
        long = calibration.compute_quality(1800, 1800, 1800)
        self.assertLess(short, long)
        self.assertAlmostEqual(long, 1.0)
        self.assertAlmostEqual(short, 300 / 1800)

    def test_quality_penalises_sparse_samples(self):
        dense = calibration.compute_quality(1800, 1800, 1800)
        sparse = calibration.compute_quality(1800, 900, 1800)
        self.assertAlmostEqual(sparse, dense * 0.5)

    def test_quality_never_exceeds_one_for_a_very_long_window(self):
        self.assertAlmostEqual(calibration.compute_quality(7200, 7200, 7200), 1.0)

    def test_quality_is_zero_when_no_samples_were_expected(self):
        self.assertEqual(calibration.compute_quality(1800, 0, 0), 0.0)

    def test_legacy_json_is_imported_once_and_marked_as_carried_over(self):
        # rollback_pod.sh swaps back to a tree that reads these files, so an
        # existing baseline is real calibration and must not be thrown away.
        import json as _json
        import tempfile

        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
            _json.dump({'left_out': {'mean': 9.0, 'std': 0.5}}, f)
            path = f.name

        self.assertTrue(calibration.import_legacy_baseline('left', path, conn=self.conn))

        profile = calibration.get_profile('left', 'cap', conn=self.conn)
        self.assertEqual(profile['payload']['left_out']['mean'], 9.0)
        self.assertEqual(profile['quality'], 0.0)

        trigger = self.conn.execute('SELECT trigger FROM calibration_runs').fetchone()[0]
        self.assertEqual(trigger, calibration.TRIGGER_MIGRATION)

        # Second call is a no-op: a profile already exists.
        self.assertFalse(calibration.import_legacy_baseline('left', path, conn=self.conn))

    def test_legacy_import_is_a_no_op_when_the_file_is_absent(self):
        self.assertFalse(
            calibration.import_legacy_baseline('left', '/nonexistent/none.json', conn=self.conn)
        )

    def test_update_run_amends_the_existing_row_instead_of_adding_one(self):
        # A late failure (e.g. save_profile throwing after the success row
        # lands) must correct that row, not append a contradicting one.
        run_id = calibration.record_run(
            'left', 'cap', calibration.STATUS_SUCCESS, calibration.TRIGGER_DAILY,
            started_at=1, duration_ms=1, quality=0.9, conn=self.conn,
        )
        calibration.update_run(run_id, calibration.STATUS_FAILED, message='disk full', conn=self.conn)

        rows = self.conn.execute('SELECT COUNT(*) FROM calibration_runs').fetchone()[0]
        self.assertEqual(rows, 1)
        row = self.conn.execute(
            'SELECT status, message FROM calibration_runs WHERE id = ?', (run_id,)
        ).fetchone()
        self.assertEqual(row[0], calibration.STATUS_FAILED)
        self.assertEqual(row[1], 'disk full')

    def test_update_run_leaves_other_runs_untouched(self):
        other_id = calibration.record_run(
            'left', 'cap', calibration.STATUS_SUCCESS, calibration.TRIGGER_DAILY,
            started_at=1, duration_ms=1, quality=0.9, conn=self.conn,
        )
        target_id = calibration.record_run(
            'right', 'cap', calibration.STATUS_SUCCESS, calibration.TRIGGER_DAILY,
            started_at=2, duration_ms=1, quality=0.9, conn=self.conn,
        )
        calibration.update_run(target_id, calibration.STATUS_FAILED, message='disk full', conn=self.conn)

        other = self.conn.execute(
            'SELECT status, message FROM calibration_runs WHERE id = ?', (other_id,)
        ).fetchone()
        self.assertEqual(other[0], calibration.STATUS_SUCCESS)
        self.assertIsNone(other[1])


if __name__ == '__main__':
    unittest.main()
