"""Tests for the calibration store accessors.

Run on the pod venv (no pytest there):
    /home/dac/venv/bin/python -m unittest __tests__.test_calibration -v
"""
import unittest
import unittest.mock
import sqlite3
import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'sleep_detection'))

import logging
import get_logger as _gl

_gl._get_file_handler = lambda data_folder_path, name: logging.NullHandler()

from get_logger import get_logger, LOGGER_NAMES

for _name in LOGGER_NAMES:
    get_logger(_name)

import pandas as pd

import calibration
import cap_data

def _import_sleep_detector():
    """sleep_detector no longer touches the database, so it imports directly."""
    import sleep_detector
    return sleep_detector


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
    message TEXT,
    payload TEXT,
    source_start INTEGER,
    source_end INTEGER
);
CREATE TABLE vitals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    side TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    heart_rate INTEGER,
    hrv INTEGER,
    breathing_rate INTEGER
);
"""


class OccupiedSecondsTest(unittest.TestCase):
    """A calibration window has to be empty on both sides, not just its own."""

    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        self.conn.executescript(SCHEMA)

    def tearDown(self):
        self.conn.close()

    def _vital(self, side, ts):
        self.conn.execute(
            'INSERT INTO vitals (side, timestamp, heart_rate, hrv, breathing_rate) '
            'VALUES (?, ?, 60, 40, 14)', (side, ts),
        )

    def test_it_reports_both_sides_not_just_one(self):
        # The whole point: the left side's window is spoiled by someone on the
        # right, and a per-side query would never see them.
        self._vital('left', 1000)
        self._vital('right', 1005)
        self.assertEqual(calibration.occupied_seconds(900, 1100, conn=self.conn), [1000, 1005])

    def test_it_respects_the_requested_range(self):
        for ts in (500, 1000, 5000):
            self._vital('right', ts)
        self.assertEqual(calibration.occupied_seconds(900, 1100, conn=self.conn), [1000])

    def test_an_empty_bed_reports_nothing(self):
        self.assertEqual(calibration.occupied_seconds(0, 10_000, conn=self.conn), [])

    def test_results_come_back_sorted_and_deduplicated(self):
        # Both sides commonly write the same second, and the caller bisects.
        self._vital('right', 1005)
        self._vital('left', 1000)
        self._vital('right', 1000)
        self.assertEqual(calibration.occupied_seconds(0, 10_000, conn=self.conn), [1000, 1005])


class RunHistoryRetentionTest(unittest.TestCase):
    """calibration_profiles keeps only the latest row per (side, sensor_type).

    Anything that wants to know how a measured value moves over time therefore
    has to read the run rows, so the runs must carry the measurement itself.
    Three weeks of empty-bed floors once existed only in a rotating log because
    they did not.
    """

    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        self.conn.executescript(SCHEMA)

    def tearDown(self):
        self.conn.close()

    def test_a_run_keeps_what_it_measured(self):
        calibration.record_run(
            'left', calibration.SENSOR_TYPE_PIEZO, calibration.STATUS_SUCCESS,
            calibration.TRIGGER_DAILY, started_at=1000, duration_ms=10, quality=0.5,
            payload={'floor': 47332.0, 'percentiles': {'p99': 61000.0}},
            source_start=900, source_end=1200, conn=self.conn,
        )
        row = self.conn.execute(
            'SELECT payload, source_start, source_end FROM calibration_runs'
        ).fetchone()
        self.assertEqual(json.loads(row[0])['floor'], 47332.0)
        self.assertEqual(json.loads(row[0])['percentiles']['p99'], 61000.0)
        self.assertEqual((row[1], row[2]), (900, 1200))

    def test_history_survives_a_profile_being_overwritten(self):
        # The upsert is the whole reason these columns exist: three nights of
        # floors must still be readable after the third night replaces the
        # profile the first two wrote.
        for night, floor in enumerate([203506.0, 114471.0, 47091.0]):
            run_id = calibration.record_run(
                'right', calibration.SENSOR_TYPE_PIEZO, calibration.STATUS_SUCCESS,
                calibration.TRIGGER_DAILY, started_at=1000 + night, duration_ms=10,
                quality=0.17, payload={'floor': floor}, conn=self.conn,
            )
            calibration.save_profile(
                'right', calibration.SENSOR_TYPE_PIEZO, {'floor': floor}, quality=0.17,
                source_start=1, source_end=2, samples_used=590, run_id=run_id, conn=self.conn,
            )

        profiles = self.conn.execute(
            'SELECT COUNT(*) FROM calibration_profiles'
        ).fetchone()[0]
        self.assertEqual(profiles, 1)

        floors = [
            json.loads(r[0])['floor'] for r in self.conn.execute(
                'SELECT payload FROM calibration_runs ORDER BY started_at'
            )
        ]
        self.assertEqual(floors, [203506.0, 114471.0, 47091.0])

    def test_a_run_that_measured_nothing_stores_null_not_empty_json(self):
        # A failed or skipped run has no measurement. Storing "null" or "{}"
        # would read as "measured, and the answer was nothing".
        calibration.record_run(
            'left', calibration.SENSOR_TYPE_PIEZO, calibration.STATUS_FAILED,
            calibration.TRIGGER_DAILY, started_at=1000, duration_ms=10,
            message='no empty window', conn=self.conn,
        )
        row = self.conn.execute(
            'SELECT payload, source_start, source_end FROM calibration_runs'
        ).fetchone()
        self.assertIsNone(row[0])
        self.assertIsNone(row[1])
        self.assertIsNone(row[2])


class CalibrationStoreTest(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        self.conn.executescript(SCHEMA)

    def tearDown(self):
        self.conn.close()

    def test_absent_profile_returns_none_rather_than_raising(self):
        # A fresh install has never calibrated. That is a normal state.
        self.assertIsNone(calibration.get_profile('left', 'cap', conn=self.conn))

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

    def test_reading_an_absent_profile_does_not_raise(self):
        # The old load_baseline raised FileNotFoundError carrying a CLI command
        # to type by hand. A fresh install is a normal state, not an error.
        self.assertIsNone(calibration.get_profile('right', 'cap', conn=self.conn))


class LoadBaselineFallbackTest(unittest.TestCase):
    def test_load_baseline_returns_none_with_no_store_row_and_no_legacy_file(self):
        # A fresh install: the store has no profile and there is no legacy
        # JSON file to carry over either. load_baseline must return None
        # rather than raise or invent a baseline, since a zero/empty baseline
        # would make every reading look like a huge deviation and report an
        # occupied bed on an empty one.
        with unittest.mock.patch.object(calibration, 'get_profile', return_value=None), \
                unittest.mock.patch.object(calibration, 'import_legacy_baseline', return_value=False):
            self.assertIsNone(cap_data.load_baseline('left'))

    def test_unknown_record_keeps_matching_detection_baseline(self):
        from collections import Counter
        payload = {f'left_{name}': {'mean': 12, 'std': 1} for name in ('out', 'cen', 'in')}
        payload['provenance'] = {'format': 'capSense2', 'normalizationVersion': 1}
        counts = Counter({'capSense2': 500, 'unknown': 1})
        self.assertEqual(calibration.observed_cap_format(counts), 'capSense2')
        with unittest.mock.patch.object(calibration, 'get_profile', return_value={'payload': payload}):
            self.assertEqual(cap_data.load_baseline('left', counts), payload)
        self.assertEqual(calibration.cap_provenance(counts, 'a' * 64)['format'], 'capSense2')

    def test_store_baseline_requires_matching_observed_records(self):
        payload = {f'left_{name}': {'mean': 12, 'std': 1} for name in ('out', 'cen', 'in')}
        payload['provenance'] = {'format': 'capSense2', 'normalizationVersion': 1}
        with unittest.mock.patch.object(calibration, 'get_profile', return_value={'payload': payload}):
            self.assertEqual(cap_data.load_baseline('left', {'capSense2': 10}), payload)
            for formats in ({'capSense': 10}, {'capSense2': 10, 'capSense': 1}, {}, None):
                with self.subTest(formats=formats):
                    self.assertIsNone(cap_data.load_baseline('left', formats))
            payload['provenance']['normalizationVersion'] = 99
            self.assertIsNone(cap_data.load_baseline('left', {'capSense2': 10}))

    def test_database_failure_uses_only_matching_tagged_file(self):
        import tempfile
        with tempfile.NamedTemporaryFile('w', suffix='.json') as output:
            json.dump({'format': 'capSense2', 'version': 1,
                       'channels': {f'left_{name}': {'mean': 12, 'std': 1} for name in ('out', 'cen', 'in')}}, output)
            output.flush()
            with unittest.mock.patch.object(calibration, 'get_profile', side_effect=sqlite3.OperationalError('locked')), \
                    unittest.mock.patch.object(calibration, 'import_legacy_baseline', side_effect=sqlite3.OperationalError('locked')), \
                    unittest.mock.patch.object(cap_data, 'LEFT_CAP_BASE_LINE_FILE_PATH', output.name):
                baseline = cap_data.load_baseline('left', {'capSense2': 10})
                self.assertEqual(baseline['left_out']['mean'], 12)
                self.assertIsNone(cap_data.load_baseline('left', {'capSense': 10}))
                self.assertEqual(cap_data.load_baseline('left', {'capSense2': 10, 'unknown': 1}), baseline)

    def test_malformed_file_cannot_break_the_piezo_fallback(self):
        import tempfile
        with tempfile.NamedTemporaryFile('w', suffix='.json') as output:
            output.write('{broken')
            output.flush()
            with unittest.mock.patch.object(calibration, 'get_profile', return_value=None), \
                    unittest.mock.patch.object(cap_data, 'LEFT_CAP_BASE_LINE_FILE_PATH', output.name):
                self.assertIsNone(cap_data.load_baseline('left', {'capSense2': 10}))


class NightstandCalibrationCompatibilityTest(unittest.TestCase):
    tearDown = CalibrationStoreTest.tearDown

    def setUp(self):
        CalibrationStoreTest.setUp(self)
        # v3.6.1's writer stores channel statistics, with optional detector metadata.
        self.payloads = {}
        for side in ('left', 'right'):
            payload = {f'{side}_{channel}': {'mean': mean, 'std': 1.0}
                       for channel, mean in zip(('out', 'cen', 'in'), (12.5, 13.0, 14.5))}
            payload.update(delta_noise=0.05, reading_means={'out': 12.0, 'cen': 13.0, 'in': 14.0})
            self.payloads[side] = payload
            calibration.save_profile(side, 'cap', payload, quality=0.8, source_start=100,
                                     source_end=1900, samples_used=1800, run_id=1, conn=self.conn)
            calibration.record_occupied_level(side, 12.0, 7200, 2000, 9200, conn=self.conn)

    def test_sleep_baseline_matches_the_v361_reader_without_provenance(self):
        from pathlib import Path
        from functools import partial
        source = (Path(__file__).parent / 'fixtures/older_load_baseline.py').read_text()
        namespace = dict(calibration=calibration, sqlite3=sqlite3, logger=logging.getLogger('older-reader'))
        exec(compile(source, 'older_load_baseline.py', 'exec'), namespace)
        with unittest.mock.patch.object(calibration, 'get_profile',
                                        partial(calibration.get_profile, conn=self.conn)):
            for side in ('left', 'right'):
                expected = namespace['load_baseline'](side)
                self.assertEqual(expected, self.payloads[side])
                for formats in (None, {}, {'capSense': 10}, {'capSense2': 10}):
                    with self.subTest(side=side, formats=formats):
                        self.assertEqual(cap_data.load_baseline(side, formats), expected)

    def test_presence_baselines_and_learned_levels_keep_v361_values(self):
        from presence.cap import CapBaseline
        from presence.params import baselines_from_calibration, learned_levels, params_from_calibration
        from presence.sensors import CAPSENSE, CAPSENSE2
        profiles = calibration.load_presence_profiles(conn=self.conn)
        expected = {side: CapBaseline(mean=(12.0, 13.0, 14.0), noise=0.05)
                    for side in ('left', 'right')}
        self.assertEqual(baselines_from_calibration(profiles), expected)
        for cap_format in (CAPSENSE, CAPSENSE2):
            with self.subTest(cap_format=cap_format.name):
                self.assertEqual(baselines_from_calibration(profiles, cap_format), expected)
                self.assertTrue(learned_levels(profiles, cap_format))
        self.assertAlmostEqual(params_from_calibration(profiles, CAPSENSE2).left.enter_delta, 4.8)

    def test_tagged_learning_keeps_the_previous_untagged_level(self):
        stored = calibration.record_occupied_level(
            'left', 100.0, 7200, 10000, 17200, conn=self.conn,
            provenance={'format': 'capSense2', 'normalizationVersion': 1, 'origin': 'nightstand'})
        self.assertAlmostEqual(stored, 15.0)

    def test_untagged_file_loads_when_the_store_is_unavailable(self):
        import tempfile
        with tempfile.NamedTemporaryFile('w', suffix='.json') as output:
            json.dump(self.payloads['left'], output)
            output.flush()
            with unittest.mock.patch.object(calibration, 'get_profile', side_effect=sqlite3.OperationalError('locked')), \
                    unittest.mock.patch.object(calibration, 'import_legacy_baseline', side_effect=sqlite3.OperationalError('locked')), \
                    unittest.mock.patch.object(cap_data, 'LEFT_CAP_BASE_LINE_FILE_PATH', output.name):
                self.assertEqual(cap_data.load_baseline('left', {'capSense2': 10}), self.payloads['left'])


class CalibrationProvenanceTest(unittest.TestCase):
    setUp = CalibrationStoreTest.setUp
    tearDown = CalibrationStoreTest.tearDown
    def _import(self, payload):
        import tempfile
        with tempfile.NamedTemporaryFile('w', suffix='.json') as output:
            json.dump(payload, output)
            output.flush()
            self.assertTrue(calibration.import_legacy_baseline('left', output.name, conn=self.conn))
        profile = calibration.get_profile('left', 'cap', conn=self.conn)['payload']
        run = json.loads(self.conn.execute('SELECT payload FROM calibration_runs').fetchone()[0])
        return profile, run

    def test_tagged_upstream_import_keeps_provenance_in_profile_and_run(self):
        channels = {f'left_{name}': {'mean': 12, 'std': 1} for name in ('out', 'cen', 'in')}
        payload = {'format': 'capSense2', 'version': 1, 'channels': channels}
        profile, run = self._import(payload)
        import hashlib
        expected_hash = hashlib.sha256(json.dumps(payload).encode()).hexdigest()
        for stored in (profile, run):
            self.assertEqual(stored['left_out'], {'mean': 12, 'std': 1})
            self.assertEqual(stored['provenance'], {'format': 'capSense2', 'normalizationVersion': 1,
                                                 'origin': 'upstream', 'sourceHash': expected_hash})
        self.assertEqual(calibration.get_profile('left', 'cap', conn=self.conn)['quality'], 0)

    def test_untagged_nightstand_file_keeps_its_payload(self):
        payload = {f'left_{name}': {'mean': 12, 'std': 1} for name in ('out', 'cen', 'in')}
        profile, run = self._import(payload)
        self.assertEqual(profile, payload)
        self.assertEqual(run, payload)

    def test_additive_metadata_round_trips_without_changing_channel_keys(self):
        provenance = {'format': 'capSense', 'normalizationVersion': 1,
                      'origin': 'nightstand', 'sourceHash': 'b' * 64}
        profile, run = self._import({'left_out': {'mean': 500, 'std': 5}, 'provenance': provenance})
        self.assertEqual(profile['provenance'], provenance)
        self.assertEqual(run['left_out']['mean'], 500)

    def test_calibration_rejects_mixed_and_unknown_windows(self):
        for counts in ({'capSense': 10, 'capSense2': 20}, {'unknown': 1}, {}):
            with self.subTest(counts=counts), self.assertRaises(ValueError):
                calibration.cap_provenance(counts, 'a' * 64)

    def test_calibration_records_known_format_and_source_hash(self):
        self.assertEqual(calibration.cap_provenance({'capSense2': 100}, 'a' * 64),
                         {'format': 'capSense2', 'normalizationVersion': 1,
                          'origin': 'nightstand', 'sourceHash': 'a' * 64})

    def test_unsupported_tags_never_become_visible_to_the_older_reader(self):
        import tempfile
        from pathlib import Path
        from types import SimpleNamespace
        source = (Path(__file__).parent / 'fixtures/older_load_baseline.py').read_text()
        namespace = dict(calibration=SimpleNamespace(
            get_profile=lambda side, sensor: calibration.get_profile(side, sensor, conn=self.conn),
            import_legacy_baseline=lambda side, path: calibration.import_legacy_baseline(side, path, conn=self.conn)),
            sqlite3=sqlite3, logger=logging.getLogger('older-reader'),
            LEFT_CAP_BASE_LINE_FILE_PATH='/nonexistent/baseline', RIGHT_CAP_BASELINE_FILE_PATH='/nonexistent/baseline')
        exec(compile(source, 'older_load_baseline.py', 'exec'), namespace)
        channels = {f'left_{name}': {'mean': 900, 'std': 1} for name in ('out', 'cen', 'in')}
        for payload in (
            {'format': 'capSense2', 'version': 99, 'channels': channels},
            {'format': 'futureCap', 'version': 1, 'channels': channels},
            {'format': 'capSense2', 'version': True, 'channels': channels},
            {'format': 'capSense2', 'channels': channels},
            dict(channels, provenance={'format': 'capSense2', 'normalizationVersion': 99}),
            dict(channels, provenance={'format': 'futureCap', 'normalizationVersion': 1}),
        ):
            with self.subTest(payload=payload), tempfile.NamedTemporaryFile('w', suffix='.json') as output:
                json.dump(payload, output)
                output.flush()
                imported = calibration.import_legacy_baseline('left', output.name, conn=self.conn)
                self.assertIsNone(namespace['load_baseline']('left'))
                self.assertFalse(imported)
                self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM calibration_runs').fetchone()[0], 0)
                self.assertIsNone(calibration.get_profile('left', 'cap', conn=self.conn))
        with tempfile.NamedTemporaryFile('w', suffix='.json') as output:
            json.dump({'format': 'capSense2', 'version': 1, 'channels': channels}, output)
            output.flush()
            self.assertTrue(calibration.import_legacy_baseline('left', output.name, conn=self.conn))
        self.assertEqual(namespace['load_baseline']('left')['left_out'], {'mean': 900, 'std': 1})

    def test_invalid_tagged_channels_are_not_imported(self):
        import tempfile
        for bad in ({}, {'left_out': {'mean': 12, 'std': 0}},
                    {'left_out': {'mean': float('nan'), 'std': 1}}):
            with self.subTest(channels=bad), tempfile.NamedTemporaryFile('w', suffix='.json') as output:
                json.dump({'format': 'capSense2', 'version': 1, 'channels': bad}, output)
                output.flush()
                self.assertFalse(calibration.import_legacy_baseline('left', output.name, conn=self.conn))
                self.assertIsNone(calibration.get_profile('left', 'cap', conn=self.conn))

    def test_new_occupied_units_do_not_step_from_an_incompatible_old_level(self):
        calibration.record_occupied_level('left', 900, 7200, 1, 7201, conn=self.conn,
                                          provenance={'format': 'capSense', 'normalizationVersion': 1})
        tag = {'format': 'capSense2', 'normalizationVersion': 1, 'origin': 'nightstand', 'sourceHash': 'a' * 64}
        self.assertEqual(calibration.record_occupied_level('left', 12, 7200, 8000, 15200,
                                                         conn=self.conn, provenance=tag), 12)
        profile = calibration.get_profile('left', 'cap_occupied', conn=self.conn)['payload']
        self.assertEqual(profile['provenance'], tag)
        self.assertIsNone(profile['before'])
        run = json.loads(self.conn.execute('SELECT payload FROM calibration_runs ORDER BY id DESC').fetchone()[0])
        self.assertEqual(run['provenance'], tag)


class FinalOccupancyPiezoOnlyFallbackTest(unittest.TestCase):
    def test_no_baseline_falls_back_to_piezo_alone(self):
        # This is the branch detect_sleep takes when load_baseline returns
        # None: final occupancy must come from piezo alone, and none of the
        # cap-only columns should appear, since detect_presence_cap never runs.
        df = pd.DataFrame({'piezo_left1_presence': [0, 1, 1, 0]})

        sleep_detector = _import_sleep_detector()
        sleep_detector._set_final_occupancy(df, 'left', None)

        self.assertTrue(df['final_left_occupied'].equals(df['piezo_left1_presence']))
        self.assertNotIn('cap_left_occupied', df.columns)
        self.assertNotIn('left_combined', df.columns)


class SleepWindowOverlapTest(unittest.TestCase):
    def test_consecutive_windows_cannot_save_the_same_overlap_start_twice(self):
        detector = _import_sleep_detector()
        index = pd.date_range('2026-09-27 12:00', '2026-09-29 13:00', freq='5min')
        entered = pd.Timestamp('2026-09-28 12:15')
        left = pd.Timestamp('2026-09-28 18:00')
        frame = pd.DataFrame({
            'final_left_occupied': ((index >= entered) & (index < left)).astype(int),
        }, index=index)
        first = detector.build_sleep_records(frame.loc[:'2026-09-28 13:00'], 'left')
        second = detector.build_sleep_records(frame.loc['2026-09-28 12:00':], 'left')
        self.assertEqual(first, [])
        self.assertEqual(len(second), 1)
        self.assertEqual(second[0]['entered_bed_at'], entered)
        self.assertEqual(second[0]['left_bed_at'], left)
        self.assertEqual(second[0]['sleep_period_seconds'], 5 * 3600 + 45 * 60)

    def test_sleep_period_requires_strictly_more_than_three_hours(self):
        detector = _import_sleep_detector()
        entered = pd.Timestamp('2026-09-28 12:00')
        self.assertEqual(detector._identify_sleep_intervals([
            (entered, entered + pd.Timedelta(hours=3)),
        ]), [])
        records = detector._identify_sleep_intervals([
            (entered, entered + pd.Timedelta(hours=3, seconds=1)),
        ])
        self.assertEqual(records[0]['sleep_period_seconds'], 10801)


if __name__ == '__main__':
    unittest.main()
