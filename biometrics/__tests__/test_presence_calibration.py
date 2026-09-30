"""What the capacitance presence detector learns from: the calibrated
baseline and its noise, recent piezo floors, and the occupied level the
analyzer reports each night."""
import json
import logging
import os
import sqlite3
import sys
import tempfile
import unittest
import unittest.mock
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'sleep_detection'))
sys.path.insert(0, os.path.dirname(__file__))

import get_logger as _gl

_gl._get_file_handler = lambda data_folder_path, name: logging.NullHandler()
from get_logger import get_logger, LOGGER_NAMES

for _name in LOGGER_NAMES:
    get_logger(_name)

import pandas as pd

import calibration
import cap_data
import load_raw_files
from cap_data import detect_presence_cap, summed_delta_noise

import presence_scenarios as scenarios

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
"""

HOUR = 3600


class StoreTestCase(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        self.conn.executescript(SCHEMA)
        self.addCleanup(self.conn.close)


class RecordOccupiedLevelTest(StoreTestCase):
    def test_first_night_is_stored_as_measured(self):
        stored = calibration.record_occupied_level('left', 21.0, 7 * HOUR, 100, 200, conn=self.conn)
        self.assertEqual(stored, 21.0)
        profile = calibration.get_profile('left', calibration.SENSOR_TYPE_CAP_OCCUPIED, conn=self.conn)
        self.assertEqual(profile['payload'], {'level': 21.0, 'measured': 21.0, 'seconds': 7 * HOUR, 'before': None})
        self.assertAlmostEqual(profile['quality'], 7 / 8)
        self.assertEqual((profile['source_start'], profile['source_end']), (100, 200))

    def test_one_night_moves_the_level_by_a_bounded_step(self):
        calibration.record_occupied_level('right', 10.0, 7 * HOUR, 0, 100, conn=self.conn)
        self.assertEqual(calibration.record_occupied_level('right', 30.0, 7 * HOUR, 200, 300, conn=self.conn), 12.5)
        self.assertEqual(calibration.record_occupied_level('right', 1.0, 7 * HOUR, 400, 500, conn=self.conn), 10.0)
        profile = calibration.get_profile('right', calibration.SENSOR_TYPE_CAP_OCCUPIED, conn=self.conn)
        self.assertEqual(profile['payload']['measured'], 1.0)

    def test_the_same_night_analyzed_again_does_not_step_twice(self):
        calibration.record_occupied_level('right', 10.0, 7 * HOUR, 0, 100, conn=self.conn)
        self.assertEqual(calibration.record_occupied_level('right', 30.0, 7 * HOUR, 200, 300, conn=self.conn), 12.5)
        # The same night again (a shorter window, a manual run): the spans overlap, so the step starts from 10 again.
        self.assertEqual(calibration.record_occupied_level('right', 30.0, 7 * HOUR, 210, 290, conn=self.conn), 12.5)
        self.assertEqual(calibration.record_occupied_level('right', 11.0, 7 * HOUR, 200, 300, conn=self.conn), 11.0)

    def test_halves_of_one_night_analyzed_separately_step_once(self):
        calibration.record_occupied_level('right', 10.0, 7 * HOUR, -80_000, -60_000, conn=self.conn)
        self.assertEqual(calibration.record_occupied_level('right', 30.0, 7 * HOUR, 2000, 10_000, conn=self.conn), 12.5)
        self.assertEqual(calibration.record_occupied_level('right', 30.0, 7 * HOUR, 2000, 5000, conn=self.conn), 12.5)
        self.assertEqual(calibration.record_occupied_level('right', 30.0, 7 * HOUR, 6000, 10_000, conn=self.conn), 12.5)
        profile = calibration.get_profile('right', calibration.SENSOR_TYPE_CAP_OCCUPIED, conn=self.conn)
        self.assertEqual((profile['source_start'], profile['source_end']), (2000, 10_000))
        self.assertEqual(profile['payload']['before'], 10.0)

    def test_back_to_back_nights_that_touch_are_two_nights(self):
        # The second night starts five minutes before the first one's span ends.
        calibration.record_occupied_level('left', 10.0, 7 * HOUR, 0, 8 * HOUR, conn=self.conn)
        first = 8 * HOUR - 300
        self.assertEqual(calibration.record_occupied_level('left', 30.0, 7 * HOUR, first, first + 8 * HOUR, conn=self.conn), 12.5)
        second = first + 8 * HOUR - 300
        self.assertEqual(calibration.record_occupied_level('left', 30.0, 7 * HOUR, second, second + 8 * HOUR, conn=self.conn), 15.625)
        # The second night again over a partial window steps from the level before it, once.
        self.assertEqual(
            calibration.record_occupied_level('left', 30.0, 7 * HOUR, second + HOUR, second + 5 * HOUR, conn=self.conn), 15.625)

    def test_an_older_night_analyzed_again_leaves_the_level_alone(self):
        calibration.record_occupied_level('right', 10.0, 7 * HOUR, 0, 100, conn=self.conn)
        calibration.record_occupied_level('right', 12.0, 7 * HOUR, 200, 300, conn=self.conn)
        self.assertIsNone(calibration.record_occupied_level('right', 30.0, 7 * HOUR, 10, 90, conn=self.conn))
        profile = calibration.get_profile('right', calibration.SENSOR_TYPE_CAP_OCCUPIED, conn=self.conn)
        self.assertEqual(profile['payload']['level'], 12.0)
        self.assertEqual((profile['source_start'], profile['source_end']), (200, 300))

    def test_a_malformed_stored_level_is_read_as_no_level(self):
        calibration.save_profile('left', 'cap_occupied', ['x'], 0.9, 0, 100, 1, 1, conn=self.conn)
        self.assertEqual(calibration.record_occupied_level('left', 30.0, 7 * HOUR, 200, 300, conn=self.conn), 30.0)

    def test_numpy_values_from_the_analyzer_are_stored(self):
        import numpy as np
        stored = calibration.record_occupied_level(
            'left', np.float64(21.0), np.int64(7 * HOUR), np.int64(100), np.int64(200), conn=self.conn)
        self.assertEqual(stored, 21.0)
        profile = calibration.get_profile('left', calibration.SENSOR_TYPE_CAP_OCCUPIED, conn=self.conn)
        self.assertEqual((profile['source_start'], profile['source_end']), (100, 200))

    def test_short_or_unusable_nights_store_nothing(self):
        self.assertIsNone(calibration.record_occupied_level('left', 20.0, HOUR, 0, 1, conn=self.conn))
        self.assertIsNone(calibration.record_occupied_level('left', float('nan'), 7 * HOUR, 0, 1, conn=self.conn))
        self.assertIsNone(calibration.record_occupied_level('left', -2.0, 7 * HOUR, 0, 1, conn=self.conn))
        self.assertIsNone(calibration.get_profile('left', calibration.SENSOR_TYPE_CAP_OCCUPIED, conn=self.conn))

    def test_each_run_leaves_a_run_row(self):
        calibration.record_occupied_level('left', 20.0, 7 * HOUR, 0, 1, conn=self.conn)
        calibration.record_occupied_level('left', 21.0, 7 * HOUR, 0, 1, conn=self.conn)
        rows = self.conn.execute(
            "SELECT status, payload FROM calibration_runs WHERE sensor_type = 'cap_occupied' ORDER BY id"
        ).fetchall()
        self.assertEqual([row[0] for row in rows], ['success', 'success'])
        self.assertEqual(json.loads(rows[1][1])['level'], 21.0)

    def test_the_capacitance_baseline_is_left_alone(self):
        calibration.save_profile('left', 'cap', {'left_out': {'mean': 11.0, 'std': 1}}, 0.16, 0, 1, 300, 1, conn=self.conn)
        calibration.record_occupied_level('left', 20.0, 7 * HOUR, 0, 1, conn=self.conn)
        self.assertEqual(calibration.get_profile('left', 'cap', conn=self.conn)['payload'], {'left_out': {'mean': 11.0, 'std': 1}})


class PresenceProfilesTest(StoreTestCase):
    def _floor_run(self, side, floor, started_at, status='success', quality=0.16):
        calibration.record_run(
            side, calibration.SENSOR_TYPE_PIEZO, status, calibration.TRIGGER_DAILY,
            started_at=started_at, duration_ms=0, quality=quality,
            payload={'floor': floor} if floor is not None else None, conn=self.conn,
        )

    def test_newest_three_clean_floors_newest_first(self):
        for day, floor in enumerate([10_000.0, 20_000.0, 30_000.0, 40_000.0]):
            self._floor_run('left', floor, day)
        self._floor_run('left', 99_000.0, 10, status='failed')
        self._floor_run('left', 88_000.0, 11, quality=0.05)
        self._floor_run('left', None, 12)
        self._floor_run('right', 55_000.0, 13)
        self.assertEqual(calibration.recent_piezo_floors('left', conn=self.conn), [40_000.0, 30_000.0, 20_000.0])
        self.assertEqual(calibration.recent_piezo_floors('right', conn=self.conn), [55_000.0])

    def test_profiles_for_both_sides(self):
        calibration.save_profile('left', 'cap', {'left_out': {'mean': 11.0, 'std': 1}}, 0.16, 0, 1, 300, 1, conn=self.conn)
        calibration.record_occupied_level('left', 20.0, 7 * HOUR, 0, 1, conn=self.conn)
        self._floor_run('left', 36_000.0, 5)
        profiles = calibration.load_presence_profiles(conn=self.conn)
        self.assertEqual(profiles['left'], {
            'cap': {'left_out': {'mean': 11.0, 'std': 1}},
            'cap_occupied': {'level': 20.0, 'measured': 20.0, 'seconds': 7 * HOUR, 'before': None},
            'piezo_floors': [36_000.0],
        })
        self.assertEqual(profiles['right'], {'cap': None, 'cap_occupied': None, 'piezo_floors': []})


class ProfilesForAWindowTest(StoreTestCase):
    """The analyzer reads the level from before the night its window covers."""

    def occupied(self, window):
        return calibration.load_presence_profiles(conn=self.conn, window=window)['left']['cap_occupied']

    def test_a_window_over_the_stored_night_reads_the_level_before_it(self):
        calibration.record_occupied_level('left', 20.0, 7 * HOUR, 0, 7 * HOUR, conn=self.conn)
        calibration.record_occupied_level('left', 22.0, 7 * HOUR, 24 * HOUR, 31 * HOUR, conn=self.conn)
        self.assertEqual(self.occupied((23 * HOUR, 32 * HOUR)), {'level': 20.0})
        self.assertEqual(self.occupied((12 * HOUR, 37 * HOUR)), {'level': 20.0})

    def test_the_first_night_ever_analyzed_again_reads_no_level(self):
        calibration.record_occupied_level('left', 20.0, 7 * HOUR, 0, 7 * HOUR, conn=self.conn)
        self.assertIsNone(self.occupied((-HOUR, 8 * HOUR)))

    def test_the_next_night_reads_the_stored_level(self):
        calibration.record_occupied_level('left', 20.0, 7 * HOUR, 0, 7 * HOUR, conn=self.conn)
        stored = calibration.get_profile('left', calibration.SENSOR_TYPE_CAP_OCCUPIED, conn=self.conn)['payload']
        self.assertEqual(self.occupied((12 * HOUR, 37 * HOUR)), stored)
        self.assertEqual(self.occupied(None), stored)

    def test_a_window_touching_the_night_is_another_night(self):
        calibration.record_occupied_level('left', 20.0, 7 * HOUR, 0, 7 * HOUR, conn=self.conn)
        self.assertEqual(self.occupied((6 * HOUR, 31 * HOUR))['level'], 20.0)


class DeltaNoiseTest(unittest.TestCase):
    def _window(self, rows):
        index = pd.date_range('2026-09-28 19:00', periods=len(rows), freq='500ms')
        return pd.DataFrame(rows, columns=['left_out', 'left_cen', 'left_in'], index=index)

    def test_std_of_the_channel_sum(self):
        window = self._window([[11.0, 10.0, 15.0], [11.1, 10.0, 15.0], [11.0, 10.1, 15.1], [10.9, 10.0, 15.0]])
        expected = pd.Series([36.0, 36.1, 36.2, 35.9]).std()
        self.assertAlmostEqual(summed_delta_noise(window, 'left'), expected)

    def test_sentinel_rows_are_left_out(self):
        window = self._window([[11.0, 10.0, 15.0], [-1.0, -1.0, -1.0], [11.0, 10.0, 15.0]])
        self.assertEqual(summed_delta_noise(window, 'left'), 0.0)

    def test_rows_with_a_missing_raw_value_are_left_out(self):
        # One raw value of the out pair was -1, so that channel reads about half its level.
        window = self._window([[11.0, 10.0, 15.0], [5.0, 10.0, 15.0], [11.1, 10.0, 15.0], [11.0, 10.1, 15.0]])
        window['left_no_reading'] = [False, True, False, False]
        expected = pd.Series([36.0, 36.1, 36.1]).std()
        self.assertAlmostEqual(summed_delta_noise(window, 'left'), expected)

    def test_rows_with_a_missing_channel_are_left_out(self):
        window = self._window([[11.0, 10.0, 15.0], [11.0, -1.0, 15.0], [float('nan'), 10.0, 15.0], [11.1, 10.0, 15.0]])
        self.assertAlmostEqual(summed_delta_noise(window, 'left'), pd.Series([36.0, 36.1]).std())

    def test_a_window_too_thin_to_measure_reads_zero(self):
        self.assertEqual(summed_delta_noise(self._window([[11.0, 10.0, 15.0]]), 'left'), 0.0)

    def test_the_extra_key_does_not_change_capacitance_detection(self):
        baseline = {f'left_{name}': {'mean': mean, 'std': 1} for name, mean in (('out', 11.0), ('cen', 10.0), ('in', 15.0))}
        rows = [[11.0, 10.0, 15.0]] * 20 + [[18.0, 12.0, 20.0]] * 20
        plain = self._window(rows)
        noisy = self._window(rows)
        detect_presence_cap(plain, baseline, 'left', occupancy_threshold=5, rolling_seconds=10, threshold_percent=0.9, clean=False)
        detect_presence_cap(noisy, {**baseline, 'delta_noise': 0.05}, 'left', occupancy_threshold=5,
                            rolling_seconds=10, threshold_percent=0.9, clean=False)
        pd.testing.assert_frame_equal(plain, noisy)


# Every 600th capSense2 record carries one -1 in the out pair, the half-level
# rows Pod 5 writes. Two of them fall in the first empty five minutes.
PARTIAL_EVERY = 600
PARTIAL_OFFSET = 100
EMPTY_SECONDS = 1800


def empty_bed_records():
    cap_index = 0
    quiet = scenarios.piezo_samples(2_000.0)
    for second in range(EMPTY_SECONDS):
        yield {
            'type': 'piezo-dual', 'ts': scenarios.T0 + second, 'freq': 500, 'adc': 1, 'gain': 400,
            'left1': quiet, 'left2': quiet, 'right1': quiet, 'right2': quiet, 'seq': second,
        }
        for _ in range(2):
            record = {'type': 'capSense2', 'ts': scenarios.T0 + second, 'version': 1}
            for side in scenarios.SIDES:
                wobble = 0.01 * (cap_index % 5 - 2)
                values = []
                for mean in scenarios.BASELINE_MEANS[side]:
                    values += [mean + wobble, mean + wobble]
                if cap_index % PARTIAL_EVERY == PARTIAL_OFFSET:
                    values[0] = -1.0
                record[side] = {'values': values + [1.2, 1.2], 'status': 'good'}
            yield record
            cap_index += 1


class CalibratorRunTest(unittest.TestCase):
    """The whole calibrator over an empty bed, with the new sleep tracking off and on."""

    @classmethod
    def setUpClass(cls):
        import calibrate_sensor_thresholds
        cls.calibrator = calibrate_sensor_thresholds

    def _calibrate(self, enabled):
        conn = sqlite3.connect(':memory:')
        self.addCleanup(conn.close)
        conn.executescript(SCHEMA + 'CREATE TABLE vitals (timestamp INTEGER NOT NULL);')
        with tempfile.TemporaryDirectory() as folder:
            scenarios.write_raw_file(os.path.join(folder, 'empty.RAW'), empty_bed_records())
            legacy = os.path.join(folder, 'left_cap_baseline.json')
            start = datetime.fromtimestamp(scenarios.T0, timezone.utc)
            with unittest.mock.patch.object(load_raw_files.logger, 'folder_path', os.path.join(folder, '')), \
                    unittest.mock.patch.object(cap_data, 'LEFT_CAP_BASE_LINE_FILE_PATH', legacy), \
                    unittest.mock.patch.object(calibration, '_connection', lambda conn_=None: conn_ or conn), \
                    unittest.mock.patch.object(self.calibrator, 'biometrics_v2_enabled', return_value=enabled):
                self.calibrator.calibrate_sensor_thresholds(
                    'left', start, start + timedelta(seconds=EMPTY_SECONDS), folder)
            with open(legacy, 'rb') as handle:
                legacy_bytes = handle.read()
        return calibration.get_profile('left', 'cap', conn=conn)['payload'], legacy_bytes

    def test_switched_off_the_baseline_is_what_it_always_was(self):
        payload, legacy_bytes = self._calibrate(enabled=False)
        self.assertEqual(sorted(payload), ['left_cen', 'left_in', 'left_out'])
        self.assertEqual(legacy_bytes, json.dumps(payload, indent=4).encode())

    def test_switched_on_the_noise_is_added_and_the_channels_are_unchanged(self):
        off, _ = self._calibrate(enabled=False)
        on, legacy_bytes = self._calibrate(enabled=True)
        noise = on.pop('delta_noise')
        self.assertEqual(on, off)
        self.assertEqual(json.loads(legacy_bytes)['delta_noise'], noise)
        # The wobble alone; with the half-level rows left in it reads about 0.26.
        self.assertGreater(noise, 0.0)
        self.assertLess(noise, 0.1)


if __name__ == '__main__':
    unittest.main()
