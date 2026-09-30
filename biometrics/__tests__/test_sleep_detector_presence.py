"""With the new sleep tracking on, the nightly analyzer reads each side's
presence from the shared capacitance detector, and falls back to the older
rule whenever that detector has nothing to work with."""
import hashlib
import dataclasses
import json
import logging
import os
import sqlite3
import sys
import tempfile
import unittest
import unittest.mock
from datetime import datetime, timezone
from functools import partial

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
sys.path.insert(0, os.path.join(HERE, '..', 'sleep_detection'))
sys.path.insert(0, HERE)

import get_logger as _gl

_gl._get_file_handler = lambda data_folder_path, name: logging.NullHandler()
from get_logger import get_logger, LOGGER_NAMES

for _logger_name in LOGGER_NAMES:
    get_logger(_logger_name)

import pandas as pd

import calibration
import load_raw_files
import sleep_detector
import presence_scenarios as scenarios
from test_presence_calibration import SCHEMA

T0 = scenarios.T0
GOLDEN_PATH = os.path.join(HERE, 'fixtures', 'toggle_off_golden.json')


def cap_payload(side, **extra):
    payload = {
        f'{side}_{channel}': {'mean': mean, 'std': 1}
        for channel, mean in zip(('out', 'cen', 'in'), scenarios.BASELINE_MEANS[side])
    }
    payload.update(extra)
    return payload


def profiles(with_baseline=True):
    return {
        side: {
            'cap': cap_payload(side, delta_noise=0.05) if with_baseline else None,
            'cap_occupied': None,
            'piezo_floors': [],
        }
        for side in ('left', 'right')
    }


def as_legacy_cap_sense(record):
    """The same reading in the capSense shape older Pods write."""
    if record['type'] != 'capSense2':
        return record
    converted = {'type': 'capSense', 'ts': record['ts']}
    for side in ('left', 'right'):
        values = record[side]['values']
        converted[side] = {
            'out': (values[0] + values[1]) / 2, 'cen': (values[2] + values[3]) / 2,
            'in': (values[4] + values[5]) / 2, 'status': 'good',
        }
    return converted


def analyze(side, records, enabled, presence_profiles=None, profiles_error=None, window=None):
    """Run detect_sleep over records; returns (records, frame hash, stored occupied levels).

    window is (first, last) seconds from the start of the night; the default covers the whole night.
    """
    first, last = window or (-60, scenarios.STAGGERED.seconds + 60)
    with tempfile.TemporaryDirectory() as folder:
        scenarios.write_raw_file(os.path.join(folder, 'night.RAW'), records)
        start = datetime.fromtimestamp(T0 + first, timezone.utc)
        end = datetime.fromtimestamp(T0 + last, timezone.utc)
        stored = []
        load_profiles = unittest.mock.Mock(return_value=presence_profiles, side_effect=profiles_error)
        with unittest.mock.patch.object(load_raw_files.logger, 'folder_path', os.path.join(folder, '')), \
                unittest.mock.patch.object(sleep_detector, 'load_baseline', return_value=cap_payload(side)), \
                unittest.mock.patch.object(sleep_detector, 'biometrics_v2_enabled', return_value=enabled), \
                unittest.mock.patch.object(sleep_detector.calibration, 'load_presence_profiles', load_profiles), \
                unittest.mock.patch.object(sleep_detector.calibration, 'record_occupied_level',
                                           side_effect=lambda *args: stored.append(args)):
            merged_df, records, _ = sleep_detector.detect_sleep(side, start, end, folder)
    frame_hash = hashlib.sha256(merged_df.to_csv(float_format='%.6f').encode()).hexdigest()
    return records, frame_hash, stored


def as_json(records):
    return json.loads(json.dumps(records, default=lambda value: value.isoformat()))


def utc(offset):
    return datetime.fromtimestamp(T0 + offset, timezone.utc).replace(tzinfo=None)


class CapacitancePresenceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.results = {
            side: analyze(side, scenarios.raw_records(scenarios.STAGGERED), True, profiles())
            for side in ('left', 'right')
        }

    def test_each_side_gets_its_own_night(self):
        left = self.results['left'][0]
        right = self.results['right'][0]
        self.assertEqual(len(left), 1)
        self.assertEqual(len(right), 1)
        self.assertEqual((left[0]['entered_bed_at'], left[0]['left_bed_at']), (utc(1819), utc(13_859)))
        self.assertEqual((right[0]['entered_bed_at'], right[0]['left_bed_at']), (utc(619), utc(15_059)))
        self.assertEqual(right[0]['times_exited_bed'], 0)
        self.assertNotEqual(left[0]['present_intervals'], right[0]['present_intervals'])

    def test_the_occupied_level_is_reported_for_the_analyzed_side(self):
        side, level, seconds, span_start, span_end = self.results['left'][2][0]
        self.assertEqual(side, 'left')
        self.assertAlmostEqual(level, 20.0, places=3)
        self.assertEqual(seconds, 13_859 - 1819)
        self.assertEqual((span_start, span_end), (T0 + 1819, T0 + 13_859))
        side, level, _, _, _ = self.results['right'][2][0]
        self.assertEqual(side, 'right')
        self.assertAlmostEqual(level, 10.0, places=3)

    def test_a_window_around_the_sleep_gives_the_same_records_and_level(self):
        # As when the analysis runs shortly after a sleep ends, over less than the whole day.
        for side in ('left', 'right'):
            with self.subTest(side=side):
                short = analyze(side, scenarios.raw_records(scenarios.STAGGERED), True, profiles(), window=(300, 15_600))
                whole = self.results[side]
                self.assertEqual(as_json(short[0]), as_json(whole[0]))
                self.assertEqual(short[2], whole[2])


class NightLevelTest(unittest.TestCase):
    def test_a_short_daytime_sit_in_the_window_does_not_change_the_stored_level(self):
        # 5 minutes on the bed 20 minutes after the night ends: past the merge gap, under the 3 hour minimum.
        with_sit = dataclasses.replace(scenarios.STAGGERED, left=((1800, 13_800), (15_000, 15_300)),
                                       overrides=scenarios.STAGGERED.overrides + (('left', 15_000, 15_300, 6.0),))
        plain = analyze('left', scenarios.raw_records(scenarios.STAGGERED), True, profiles())
        extra = analyze('left', scenarios.raw_records(with_sit), True, profiles())
        self.assertEqual(len(extra[0]), 1)
        self.assertEqual(as_json(extra[0]), as_json(plain[0]))
        self.assertEqual(len(plain[2]), 1)
        self.assertEqual(extra[2], plain[2])

    def test_a_window_with_no_sleep_stores_no_level(self):
        result = analyze('left', scenarios.raw_records(scenarios.STAGGERED), True, profiles(), window=(-60, 1000))
        self.assertEqual(result[0], [])
        self.assertEqual(result[2], [])


# Left lingers at a light capacitance rise after getting up: over the default
# exit level, under the one a learned level of 20 gives.
TAIL = dataclasses.replace(scenarios.STAGGERED, overrides=scenarios.STAGGERED.overrides + (('left', 13_800, 14_400, 2.2),))
WHOLE = (-60, TAIL.seconds + 60)
AROUND_SLEEP = (300, 15_600)


class ReanalysisTest(unittest.TestCase):
    """A night analyzed again, over the same or another window, keeps its records."""

    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        self.conn.executescript(SCHEMA)
        self.addCleanup(self.conn.close)
        for side in ('left', 'right'):
            calibration.save_profile(side, 'cap', cap_payload(side, delta_noise=0.05), 0.5, 0, 1, 300, 1, conn=self.conn)

    def analyze(self, side, window):
        with tempfile.TemporaryDirectory() as folder:
            scenarios.write_raw_file(os.path.join(folder, 'night.RAW'), scenarios.raw_records(TAIL))
            start = datetime.fromtimestamp(T0 + window[0], timezone.utc)
            end = datetime.fromtimestamp(T0 + window[1], timezone.utc)
            with unittest.mock.patch.object(load_raw_files.logger, 'folder_path', os.path.join(folder, '')), \
                    unittest.mock.patch.object(sleep_detector, 'load_baseline', return_value=cap_payload(side)), \
                    unittest.mock.patch.object(sleep_detector, 'biometrics_v2_enabled', return_value=True), \
                    unittest.mock.patch.object(sleep_detector.calibration, 'load_presence_profiles',
                                               partial(calibration.load_presence_profiles, conn=self.conn)), \
                    unittest.mock.patch.object(sleep_detector.calibration, 'record_occupied_level',
                                               partial(calibration.record_occupied_level, conn=self.conn)):
                _, records, _ = sleep_detector.detect_sleep(side, start, end, folder)
        return as_json(records)

    def runs(self, windows):
        return [{side: self.analyze(side, window) for side in ('left', 'right')} for window in windows]

    def assert_same_every_run(self, windows):
        first, *later = self.runs(windows)
        self.assertEqual(len(first['left']), 1)
        for result in later:
            self.assertEqual(result, first)

    def test_the_same_night_twice(self):
        self.assert_same_every_run([WHOLE, WHOLE, WHOLE])

    def test_a_window_around_the_sleep_then_the_whole_day(self):
        self.assert_same_every_run([AROUND_SLEEP, WHOLE])

    def test_the_whole_day_then_a_window_around_the_sleep(self):
        self.assert_same_every_run([WHOLE, AROUND_SLEEP])

    def test_the_level_learned_the_night_before_is_the_one_used(self):
        day = 24 * 3600
        for side, level in (('left', 10.0), ('right', 10.0)):
            calibration.record_occupied_level(side, level, 7 * 3600, T0 - day, T0 - day + 7 * 3600, conn=self.conn)
        self.assert_same_every_run([WHOLE, AROUND_SLEEP, WHOLE])
        # Exit at 2 from the level of 10 keeps the tail in bed; the night's own level of 20 would end it.
        left = self.runs([WHOLE])[0]['left'][0]
        self.assertGreater(left['left_bed_at'], utc(14_400).isoformat())

    def test_learning_still_happens_once_per_night(self):
        self.runs([WHOLE, AROUND_SLEEP])
        profile = calibration.get_profile('left', calibration.SENSOR_TYPE_CAP_OCCUPIED, conn=self.conn)
        self.assertAlmostEqual(profile['payload']['level'], 20.0, places=3)
        self.assertIsNone(profile['payload']['before'])


class FallbackTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(GOLDEN_PATH) as handle:
            cls.golden = json.load(handle)['analyzer']

    def assert_matches_golden(self, side, result):
        records, frame_hash, stored = result
        self.assertEqual(as_json(records), self.golden[side]['records'])
        self.assertEqual(frame_hash, self.golden[side]['frame_sha256'])
        self.assertEqual(stored, [])

    def test_no_capacitance_baseline_reads_the_night_as_before(self):
        self.assert_matches_golden('left', analyze(
            'left', scenarios.raw_records(scenarios.STAGGERED), True, profiles(with_baseline=False)))

    def test_an_unreadable_calibration_store_reads_the_night_as_before(self):
        self.assert_matches_golden('right', analyze(
            'right', scenarios.raw_records(scenarios.STAGGERED), True,
            profiles_error=sqlite3.OperationalError('database is locked')))

    def test_any_failure_setting_up_reads_the_night_as_before(self):
        self.assert_matches_golden('left', analyze(
            'left', scenarios.raw_records(scenarios.STAGGERED), True,
            profiles_error=RuntimeError('boom')))
        with unittest.mock.patch.object(sleep_detector, 'params_from_calibration', side_effect=TypeError('boom')):
            self.assert_matches_golden('right', analyze(
                'right', scenarios.raw_records(scenarios.STAGGERED), True, profiles()))

    def test_a_corrupt_calibration_row_reads_the_night_as_before(self):
        self.assert_matches_golden('left', analyze(
            'left', scenarios.raw_records(scenarios.STAGGERED), True,
            profiles_error=json.JSONDecodeError('Expecting value', '{', 1)))

    def test_an_unexpected_failure_in_the_replay_reads_the_night_as_before(self):
        with unittest.mock.patch.object(sleep_detector, 'replay', side_effect=RuntimeError('boom')):
            self.assert_matches_golden('left', analyze(
                'left', scenarios.raw_records(scenarios.STAGGERED), True, profiles()))

    def test_an_unexpected_failure_in_the_level_reads_the_night_as_before(self):
        with unittest.mock.patch.object(sleep_detector, 'occupied_level', side_effect=RuntimeError('boom')):
            self.assert_matches_golden('right', analyze(
                'right', scenarios.raw_records(scenarios.STAGGERED), True, profiles()))

    def test_capsense2_for_part_of_the_night_reads_the_night_as_before(self):
        # Readings for the first 30% of the night only.
        cutoff = T0 + int(scenarios.STAGGERED.seconds * 0.3)
        partial = [record for record in scenarios.raw_records(scenarios.STAGGERED)
                   if record['type'] != 'capSense2' or record['ts'] < cutoff]
        on = analyze('left', partial, True, profiles())
        off = analyze('left', partial, False, profiles())
        self.assertEqual(on, off)
        self.assertEqual(on[2], [])

    def test_a_pod_without_capsense2_reads_the_night_as_before(self):
        legacy = [as_legacy_cap_sense(record) for record in scenarios.raw_records(scenarios.STAGGERED)]
        on = analyze('left', legacy, True, profiles())
        off = analyze('left', legacy, False, profiles())
        self.assertEqual(on, off)
        self.assertEqual(len(on[0]), 1)


class CoverageBoundaryTest(unittest.TestCase):
    class Collector:
        def __init__(self, coverage):
            self.coverage = coverage

        def cap_coverage(self):
            return self.coverage

        def frames(self):
            return iter([])

    def replay_side(self, coverage):
        params = sleep_detector.params_from_calibration(profiles())
        return sleep_detector._replay_side(self.Collector(coverage), params, 'left')

    def test_half_of_the_window_covered_is_enough(self):
        self.assertEqual(self.replay_side(sleep_detector.MIN_CAP_COVERAGE), [])

    def test_just_under_half_reads_the_night_as_before(self):
        self.assertIsNone(self.replay_side(sleep_detector.MIN_CAP_COVERAGE - 0.001))


class OccupancyFromIntervalsTest(unittest.TestCase):
    def test_marks_timestamps_inside_half_open_intervals(self):
        index = pd.to_datetime([utc(offset) for offset in (0, 9, 10, 11, 19, 20, 30, 31)])
        occupied = sleep_detector._occupancy_from_intervals(index, [(T0 + 10, T0 + 20), (T0 + 30, T0 + 31)])
        self.assertEqual(occupied.tolist(), [0, 0, 1, 1, 1, 0, 1, 0])

    def test_no_intervals_marks_nothing(self):
        index = pd.to_datetime([utc(0), utc(1)])
        self.assertEqual(sleep_detector._occupancy_from_intervals(index, []).tolist(), [0, 0])


if __name__ == '__main__':
    unittest.main()
