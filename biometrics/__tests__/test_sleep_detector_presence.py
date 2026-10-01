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
from insufficient_data import InsufficientDataError
from presence import model
from presence.params import baselines_from_calibration
from presence.replay import FrameCollector
from presence.sensors import CAPSENSE, CAPSENSE2
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


def analyze(side, records, enabled, presence_profiles=None, profiles_error=None, window=None, baseline=None):
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
                unittest.mock.patch.object(sleep_detector, 'load_baseline', return_value=baseline or cap_payload(side)), \
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

    def test_two_capacitance_formats_in_one_window_read_the_night_as_before(self):
        # A cover change during the night: capSense2 first, then capSense counts.
        records = (list(scenarios.raw_records(scenarios.STAGGERED, end=9000))
                   + list(scenarios.legacy_raw_records(scenarios.STAGGERED, 50.0, start=9000)))
        with self.assertLogs(sleep_detector.logger, level='WARNING') as logs:
            on = analyze('left', records, True, profiles())
        off = analyze('left', records, False, profiles())
        self.assertEqual(on, off)
        self.assertEqual(on[2], [])
        self.assertTrue(any('more than one format' in line for line in logs.output))

    def test_legacy_capsense_without_a_baseline_reads_the_night_as_before(self):
        legacy = list(scenarios.legacy_raw_records(scenarios.STAGGERED, 50.0))
        no_baseline = {side: {'cap': None, 'cap_occupied': None, 'piezo_floors': []} for side in ('left', 'right')}
        payload = scenarios.legacy_cap_payload('left')
        on = analyze('left', legacy, True, no_baseline, baseline=payload)
        off = analyze('left', legacy, False, no_baseline, baseline=payload)
        self.assertEqual(on, off)
        self.assertEqual(len(on[0]), 1)


def legacy_profiles(levels=None, noise=2.0):
    return {
        side: {
            'cap': scenarios.legacy_cap_payload(side, delta_noise=noise),
            'cap_occupied': None if levels is None else {'level': levels[side]},
            'piezo_floors': [],
        }
        for side in ('left', 'right')
    }


def analyze_legacy(side, counts_per_unit, enabled=True, presence_profiles=None, records=None, night=scenarios.STAGGERED):
    records = list(scenarios.legacy_raw_records(night, counts_per_unit)) if records is None else records
    return analyze(side, records, enabled, presence_profiles or legacy_profiles(),
                   baseline=scenarios.legacy_cap_payload(side), window=(-60, night.seconds + 60))


class LegacyCapacitanceTest(unittest.TestCase):
    """capSense counts read as an unchecked format: learned per Pod, never costing a night."""

    @classmethod
    def setUpClass(cls):
        # A rise of 1000 counts on the left and 500 on the right: clear of the 300 count start.
        cls.results = {side: analyze_legacy(side, 50.0) for side in ('left', 'right')}

    def test_each_side_gets_its_own_night(self):
        left, right = self.results['left'][0], self.results['right'][0]
        self.assertEqual((len(left), len(right)), (1, 1))
        for record, (entered, left_at) in ((left[0], (1819, 13_859)), (right[0], (619, 15_059))):
            self.assertLessEqual(abs((record['entered_bed_at'] - utc(entered)).total_seconds()), 5)
            self.assertLessEqual(abs((record['left_bed_at'] - utc(left_at)).total_seconds()), 5)
        self.assertNotEqual(left[0]['present_intervals'], right[0]['present_intervals'])

    def test_the_level_is_learned_in_counts(self):
        side, level, *_ = self.results['left'][2][0]
        self.assertEqual(side, 'left')
        self.assertAlmostEqual(level, 1000.0, delta=5.0)
        self.assertAlmostEqual(self.results['right'][2][0][1], 500.0, delta=5.0)

    def test_switched_off_the_night_reads_as_before(self):
        off = analyze_legacy('left', 50.0, enabled=False)
        self.assertEqual(off[2], [])
        self.assertNotEqual(as_json(off[0]), as_json(self.results['left'][0]))

    def test_counts_too_small_for_the_starting_level_keep_the_older_reading(self):
        # A rise of 40 counts never reaches the 300 count start, so capacitance finds no night.
        with self.assertLogs(sleep_detector.logger, level='WARNING') as logs:
            on = analyze_legacy('left', 2.0)
        off = analyze_legacy('left', 2.0, enabled=False)
        self.assertEqual(on, off)
        self.assertEqual(on[2], [])
        self.assertTrue(any('older reading' in line for line in logs.output))

    def test_a_learned_level_sets_the_thresholds(self):
        learned = analyze_legacy('left', 50.0, presence_profiles=legacy_profiles({'left': 800.0, 'right': 400.0}))
        self.assertEqual(len(learned[0]), 1)
        self.assertAlmostEqual(learned[2][0][1], 1000.0, delta=5.0)

    def test_piezo_two_seconds_apart_reads_the_night_as_before(self):
        records = list(scenarios.legacy_raw_records(scenarios.STAGGERED, 50.0, piezo_every=2))
        on = analyze_legacy('left', 50.0, records=records)
        off = analyze_legacy('left', 50.0, enabled=False, records=records)
        self.assertEqual(on, off)

    def test_an_unknown_capacitance_type_fails_as_before_and_says_so(self):
        records = [dict(record, type='capSense3') if record['type'] == 'capSense2' else record
                   for record in scenarios.raw_records(scenarios.STAGGERED)]
        with self.assertLogs(sleep_detector.logger, level='WARNING') as logs:
            with self.assertRaises(InsufficientDataError):
                analyze('left', records, True, profiles())
        with self.assertRaises(InsufficientDataError):
            analyze('left', records, False, profiles())
        self.assertTrue(any('capSense3' in line for line in logs.output))


# Left's capacitance stays flat for most of the night, so it reads a much shorter night than the older rule.
FLAT_LEFT = dataclasses.replace(scenarios.STAGGERED,
                                overrides=scenarios.STAGGERED.overrides + (('left', 1800, 10_000, 0.0),))


def analyze_on(pod5, side, enabled=True, night=FLAT_LEFT):
    with unittest.mock.patch.object(model, 'is_pod5', return_value=pod5):
        return analyze(side, scenarios.raw_records(night), enabled, profiles(), window=(-60, night.seconds + 60))


class OtherPodCapsense2Test(unittest.TestCase):
    """capSense2 on any Pod but a Pod 5 is read as an unchecked format, never costing a night."""

    def test_a_pod_5_reads_the_night_from_capacitance(self):
        # Too short a night to keep, where the older rule finds a whole one.
        self.assertEqual(analyze_on(True, 'left')[0], [])
        self.assertEqual(len(analyze_on(True, 'left', enabled=False)[0]), 1)

    def test_another_pod_keeps_the_older_reading_and_learns_nothing(self):
        with self.assertLogs(sleep_detector.logger, level='WARNING') as logs:
            on = analyze_on(False, 'left')
        self.assertEqual(on, analyze_on(False, 'left', enabled=False))
        self.assertEqual(on[2], [])
        self.assertTrue(any('keeping the older reading' in line for line in logs.output))

    def test_another_pod_still_reads_a_good_night_from_capacitance(self):
        on = analyze_on(False, 'left', night=scenarios.STAGGERED)
        self.assertEqual(on, analyze_on(True, 'left', night=scenarios.STAGGERED))
        self.assertEqual(len(on[2]), 1)


# Eight hours in bed beside a partner who is in all night.
LONG = scenarios.Night(seconds=29_400, left=((600, 29_000),), right=((300, 29_200),))
SEEN = (10_000, 22_000)


def readings_only_while_seen(sides, counts_per_unit=50.0):
    """LONG's records, with these sides' capacitance a placeholder count outside SEEN."""
    for record in scenarios.legacy_raw_records(LONG, counts_per_unit):
        if record['type'] == 'capSense' and not SEEN[0] <= record['ts'] - T0 < SEEN[1]:
            for side in sides:
                record[side] = dict(record[side], out=-32768, cen=-32768, **{'in': -32768})
        yield record


class PartialCapacitanceTest(unittest.TestCase):
    """A night is read from capacitance only where capacitance saw nearly all of it."""

    def test_a_night_capacitance_saw_only_part_of_keeps_the_older_reading(self):
        # The right side's readings keep the window as a whole covered.
        records = list(readings_only_while_seen(('left',)))
        with self.assertLogs(sleep_detector.logger, level='WARNING') as logs:
            on = analyze_legacy('left', 50.0, records=records, night=LONG)
        off = analyze_legacy('left', 50.0, enabled=False, records=records, night=LONG)
        self.assertEqual(on, off)
        self.assertEqual(on[2], [])
        self.assertGreater((on[0][0]['left_bed_at'] - on[0][0]['entered_bed_at']).total_seconds(), 7 * 3600)
        self.assertEqual(len([line for line in logs.output if 'keeping the older reading' in line]), 1)

    def test_the_other_side_still_reads_capacitance(self):
        records = list(readings_only_while_seen(('left',)))
        right_on = analyze_legacy('right', 50.0, records=records, night=LONG)
        self.assertEqual(len(right_on[0]), 1)
        self.assertEqual(right_on[2][0][0], 'right')
        self.assertAlmostEqual(right_on[2][0][1], 500.0, delta=5.0)

    def test_a_night_capacitance_reads_as_mostly_empty_keeps_the_older_reading(self):
        # Readings keep arriving all night but rise only while SEEN, as for a
        # sleeper whose rise mostly sits under the starting level.
        flat = ('left', LONG.left[0][0], SEEN[0], 0.0), ('left', SEEN[1], LONG.left[0][1], 0.0)
        night = dataclasses.replace(LONG, overrides=flat)
        records = list(scenarios.legacy_raw_records(night, 50.0))
        with self.assertLogs(sleep_detector.logger, level='WARNING') as logs:
            on = analyze_legacy('left', 50.0, records=records, night=night)
        off = analyze_legacy('left', 50.0, enabled=False, records=records, night=night)
        self.assertEqual(on, off)
        self.assertEqual(on[2], [])
        self.assertEqual(len([line for line in logs.output if 'keeping the older reading' in line]), 1)

    def test_a_failure_comparing_with_the_older_reading_keeps_it(self):
        with unittest.mock.patch.object(sleep_detector, '_earlier_records', side_effect=RuntimeError('boom')), \
                self.assertLogs(sleep_detector.logger, level='WARNING') as logs:
            on = analyze_legacy('left', 50.0)
        self.assertEqual(on, analyze_legacy('left', 50.0, enabled=False))
        self.assertTrue(any('boom' in line and 'keeping the older reading' in line for line in logs.output))

    def test_a_partner_staggered_night_still_reads_from_capacitance(self):
        # Capacitance tells the sides apart, so the left night is shorter than the older reading's.
        def length(records):
            return (records[0]['left_bed_at'] - records[0]['entered_bed_at']).total_seconds()

        on = analyze_legacy('left', 50.0)
        off = analyze_legacy('left', 50.0, enabled=False)
        self.assertLess(length(on[0]), 0.9 * length(off[0]))
        self.assertGreater(length(on[0]), sleep_detector.MIN_NIGHT_SPAN_SHARE * length(off[0]))
        self.assertEqual(len(on[2]), 1)


class QuietOccupancyTest(unittest.TestCase):
    def test_quiet_leaves_out_the_missing_baseline_warning(self):
        index = pd.to_datetime([utc(0), utc(1)])
        for quiet, warnings in ((True, 0), (False, 1)):
            with self.subTest(quiet=quiet), unittest.mock.patch.object(sleep_detector.logger, 'warning') as warning:
                frame = pd.DataFrame({'piezo_left1_presence': [1, 0]}, index=index)
                sleep_detector._set_final_occupancy(frame, 'left', None, quiet=quiet)
                self.assertEqual(frame['final_left_occupied'].tolist(), [1, 0])
                self.assertEqual(warning.call_count, warnings)


class LosesANightTest(unittest.TestCase):
    def record(self, start, end):
        return {'entered_bed_at': utc(start), 'left_bed_at': utc(end)}

    def test_overlap_keeps_every_night(self):
        earlier = [self.record(0, 100), self.record(500, 900)]
        self.assertFalse(sleep_detector._loses_a_night(earlier, [self.record(50, 60), self.record(800, 1000)]))

    def test_a_night_with_nothing_overlapping_is_lost(self):
        earlier = [self.record(0, 100), self.record(500, 900)]
        self.assertTrue(sleep_detector._loses_a_night(earlier, [self.record(50, 60)]))
        self.assertTrue(sleep_detector._loses_a_night(earlier, []))
        self.assertFalse(sleep_detector._loses_a_night([], []))

    def test_touching_is_not_overlapping(self):
        self.assertTrue(sleep_detector._loses_a_night([self.record(0, 100)], [self.record(100, 200)]))

    def test_the_share_of_the_older_night_covered(self):
        nights = [self.record(0, 100), self.record(200, 300)]
        self.assertAlmostEqual(sleep_detector._night_span_share(nights, [self.record(-50, 50), self.record(80, 250)]), 0.5)
        self.assertEqual(sleep_detector._night_span_share([], []), 1.0)


class PresenceParamsTest(unittest.TestCase):
    """Which format's levels a run uses, and what it says when it uses none."""

    def collector(self, formats=(), unknown=()):
        collector = FrameCollector(baselines_from_calibration(profiles()))
        collector.cap_formats.update(dict(formats))
        collector.unknown_cap.update(dict(unknown))
        for second in range(200):
            collector.add_piezo(T0 + second, 1.0, 1.0)
        return collector

    def test_the_window_format_sets_the_levels(self):
        params, cap_format = sleep_detector._presence_v2_params(self.collector([('capSense', 10)]), legacy_profiles())
        self.assertIs(cap_format, CAPSENSE)
        self.assertEqual((params.left.enter_delta, params.left.exit_delta), (300.0, 150.0))
        params, cap_format = sleep_detector._presence_v2_params(self.collector([('capSense2', 10)]), profiles())
        self.assertIs(cap_format, CAPSENSE2)
        self.assertEqual(params, sleep_detector.params_from_calibration(profiles()))

    def test_two_formats_in_one_window_read_the_night_as_before(self):
        with self.assertLogs(sleep_detector.logger, level='WARNING') as logs:
            self.assertIsNone(sleep_detector._presence_v2_params(
                self.collector([('capSense2', 900), ('capSense', 300)]), profiles()))
        self.assertEqual(len(logs.output), 1)
        self.assertIn('(capSense: 300, capSense2: 900)', logs.output[0])

    def test_unknown_types_are_named_with_their_counts_in_one_line(self):
        unknown = [(f'capSense{number}', 10 + number) for number in range(3, 10)] + [('capSense' + 'x' * 100, 1)]
        with self.assertLogs(sleep_detector.logger, level='WARNING') as logs:
            self.assertIsNone(sleep_detector._presence_v2_params(self.collector(unknown=unknown), profiles()))
        self.assertEqual(len(logs.output), 1)
        self.assertIn('capSense9: 19, capSense8: 18', logs.output[0])
        self.assertIn('and 3 more', logs.output[0])
        self.assertNotIn('capSense3', logs.output[0])

    def test_unknown_types_beside_a_known_format_are_named_and_left_out(self):
        with self.assertLogs(sleep_detector.logger, level='WARNING') as logs:
            result = sleep_detector._presence_v2_params(
                self.collector([('capSense2', 10)], unknown=[('capSense' + 'x' * 100, 4)]), profiles())
        self.assertIsNotNone(result)
        self.assertEqual(len(logs.output), 1)
        self.assertIn('capSense' + 'x' * 32 + ': 4', logs.output[0])
        self.assertNotIn('x' * 33, logs.output[0])

    def test_unknown_type_names_are_logged_without_control_characters(self):
        with self.assertLogs(sleep_detector.logger, level='WARNING') as logs:
            sleep_detector._presence_v2_params(self.collector(unknown=[('capSense\n3\x1b[0m', 2)]), profiles())
        self.assertIn('capSense3[0m: 2', logs.output[0])
        self.assertNotIn('\n', logs.output[0])
        self.assertNotIn('\x1b', logs.output[0])

    def test_capsense2_on_another_pod_is_read_as_unchecked(self):
        with unittest.mock.patch.object(model, 'is_pod5', return_value=False), \
                self.assertLogs(sleep_detector.logger, level='INFO') as logs:
            params, cap_format = sleep_detector._presence_v2_params(self.collector([('capSense2', 10)]), profiles())
        self.assertEqual(cap_format.name, 'capSense2')
        self.assertFalse(cap_format.validated)
        self.assertEqual(params, sleep_detector.params_from_calibration(profiles()))
        self.assertTrue(any('not yet checked' in line for line in logs.output))

    def test_capsense2_on_another_pod_needs_piezo_once_a_second(self):
        collector = FrameCollector(baselines_from_calibration(profiles()))
        collector.cap_formats.update({'capSense2': 10})
        for second in range(0, 400, 2):
            collector.add_piezo(T0 + second, 1.0, 1.0)
        with unittest.mock.patch.object(model, 'is_pod5', return_value=True):
            self.assertIsNotNone(sleep_detector._presence_v2_params(collector, profiles()))
        with unittest.mock.patch.object(model, 'is_pod5', return_value=False), \
                self.assertLogs(sleep_detector.logger, level='WARNING'):
            self.assertIsNone(sleep_detector._presence_v2_params(collector, profiles()))

    def test_capsense2_on_an_unknown_model_is_read_as_before_and_says_so(self):
        with unittest.mock.patch.object(model, 'is_pod5', return_value=None), \
                unittest.mock.patch.object(model, '_unknown_logged', False), \
                self.assertLogs(sleep_detector.logger, level='INFO') as logs:
            params, cap_format = sleep_detector._presence_v2_params(self.collector([('capSense2', 10)]), profiles())
        self.assertIs(cap_format, CAPSENSE2)
        self.assertTrue(any('Could not read the Pod model' in line for line in logs.output))

    def test_no_readable_capacitance_says_so(self):
        with self.assertLogs(sleep_detector.logger, level='WARNING') as logs:
            self.assertIsNone(sleep_detector._presence_v2_params(self.collector(), profiles()))
        self.assertIn('No readable capacitance', logs.output[0])


class CoverageBoundaryTest(unittest.TestCase):
    class Collector:
        def __init__(self, coverage, cap_format=CAPSENSE2):
            self.coverage = coverage
            self.format = cap_format

        def cap_format(self):
            return self.format

        def cap_coverage(self):
            return self.coverage

        def frames(self):
            return iter([])

    def replay_side(self, coverage, cap_format=CAPSENSE2):
        params = sleep_detector.params_from_calibration(profiles())
        return sleep_detector._replay_side(self.Collector(coverage, cap_format), params, 'left')

    def test_the_coverage_rule_is_the_same_for_every_format(self):
        self.assertEqual(self.replay_side(1.0, CAPSENSE), [])
        self.assertIsNone(self.replay_side(sleep_detector.MIN_CAP_COVERAGE - 0.001, CAPSENSE))

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
