"""The live stream with the capacitance detector in charge: presence per
side follows each person, vitals are written only while that side is
occupied, and vitals state survives a short trip out of bed. On a format
not yet checked, the server keeps hearing the piezo detector."""
import logging
import os
import sys
import types
from types import SimpleNamespace
import unittest
import unittest.mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
sys.path.insert(0, os.path.join(HERE, '..', 'stream'))
sys.path.insert(0, HERE)

try:
    import scipy.interpolate  # noqa: F401
    import scipy.signal  # noqa: F401
except ImportError:
    _scipy = types.ModuleType('scipy')
    _scipy_interpolate = types.ModuleType('scipy.interpolate')
    _scipy_signal = types.ModuleType('scipy.signal')
    _scipy_interpolate.UnivariateSpline = object
    for _fn in ('welch', 'periodogram', 'butter', 'filtfilt', 'iirnotch', 'savgol_filter'):
        setattr(_scipy_signal, _fn, lambda *a, **k: None)
    _scipy.interpolate = _scipy_interpolate
    _scipy.signal = _scipy_signal
    sys.modules.setdefault('scipy', _scipy)
    sys.modules.setdefault('scipy.interpolate', _scipy_interpolate)
    sys.modules.setdefault('scipy.signal', _scipy_signal)

_db = sys.modules.setdefault('db', types.ModuleType('db'))
if not hasattr(_db, 'insert_vitals'):
    _db.insert_vitals = lambda *a, **k: None

import get_logger as _gl

_gl._get_file_handler = lambda data_folder_path, name: logging.NullHandler()
from get_logger import get_logger, LOGGER_NAMES

for _name in LOGGER_NAMES:
    get_logger(_name)

import biometric_processor
import stream_processor as stream_processor_module
from biometric_processor import BiometricProcessor, _PresenceCoordinator
from load_raw_files import load_piezo_row
from presence.cap import CapBaseline
from presence.detector import DetectorParams, SideParams
from presence.params import baselines_from_calibration, params_from_calibration
from presence.sensors import CAPSENSE, read_cap
from stream_processor import LatestCap, StreamProcessor, is_side_swap
import presence_scenarios as scenarios
from presence_scenarios import Night

T0 = scenarios.T0
PARAMS = DetectorParams(
    left=SideParams(enter_delta=8.0, exit_delta=4.0),
    right=SideParams(enter_delta=4.0, exit_delta=2.0),
    piezo_floor={'left': 40_000.0, 'right': 70_000.0},
)
BASELINES = {side: CapBaseline(mean=scenarios.BASELINE_MEANS[side], noise=0.05) for side in ('left', 'right')}


def fake_vitals(self, signal, epoch, update_breathing=False, update_hrv=False):
    if update_breathing:
        self.breathing_rate = 14.0
    if update_hrv:
        self.hrv = 45.0
    return {'side': self.side, 'timestamp': epoch, 'heart_rate': 60.0,
            'hrv': self.hrv, 'breathing_rate': self.breathing_rate}


def run_live(records, inputs=(PARAMS, BASELINES), switch_on_at=None, switch_off_at=None):
    """Feed records through StreamProcessor as the stream does.

    Returns every post to the server (second, side, present), every vitals
    insert (side, second, hrv), each second's presence as the vitals see it
    (second, side, present), and the processor. inputs reach the processor
    with the first piezo record, or at second switch_on_at.
    """
    _PresenceCoordinator._latest = {'left': 0.0, 'right': 0.0}
    posts, inserts, held = [], [], []
    now = [T0]

    def capture_post(processor, present):
        posts.append((now[0] - T0, processor.side, present))

    latest = LatestCap()
    with unittest.mock.patch.object(BiometricProcessor, '_update_presence_api', capture_post), \
            unittest.mock.patch.object(BiometricProcessor, '_calculate_vitals', fake_vitals), \
            unittest.mock.patch.object(biometric_processor, 'insert_vitals',
                                       side_effect=lambda row: inserts.append((row['side'], row['timestamp'] - T0, row['hrv']))):
        processor = None
        for record in records:
            reading = read_cap(record)
            if reading is not None:
                if reading.left is not None and reading.right is not None:
                    latest.update(record['ts'], reading.left, reading.right, reading.cap_format)
                continue
            load_piezo_row(record, 'right')
            now[0] = record['ts']
            second = record['ts'] - T0
            if processor is None:
                processor = StreamProcessor(record, cap_source=latest)
                if switch_on_at is None:
                    processor.use_presence_v2(inputs)
                continue
            if switch_on_at is not None and second == switch_on_at:
                processor.use_presence_v2(inputs)
            if switch_off_at is not None and second == switch_off_at:
                processor.use_presence_v2(None)
            processor.process_piezo_record(record)
            held.append((second, 'left', processor.left_processor.present))
            held.append((second, 'right', processor.right_processor.present))
    return SimpleNamespace(posts=posts, inserts=inserts, held=transitions(held), processor=processor)


def stream(night: Night, inputs=(PARAMS, BASELINES), switch_off_at=None, records=None):
    """Feed a night through StreamProcessor as the stream does; returns (transitions, inserts)."""
    run = run_live(records if records is not None else scenarios.raw_records(night), inputs, switch_off_at=switch_off_at)
    return transitions(run.posts), run.inserts


def transitions(posts):
    """Drop heartbeat repeats, keeping each side's changes of state."""
    last = {'left': False, 'right': False}
    changes = []
    for second, side, present in posts:
        if present != last[side]:
            changes.append((second, side, present))
            last[side] = present
    return changes


def inserted_seconds(inserts, side):
    return [second for row_side, second, _ in inserts if row_side == side]


class StaggeredLiveNightTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        night = Night(seconds=6000, left=((1200, 4200),), right=((300, 5000),))
        cls.changes, cls.inserts = stream(night)

    def test_each_side_enters_and_leaves_on_its_own(self):
        replayed = [(319, 'right', True), (1219, 'left', True), (4259, 'left', False), (5059, 'right', False)]
        self.assertEqual([change[1:] for change in self.changes], [change[1:] for change in replayed])
        for (second, _, _), (target, _, _) in zip(self.changes, replayed):
            # Live uses the newest capacitance record, which is a second
            # behind its piezo record and now and then the no-reading
            # sentinel, so it trails the replayed night by a second or two.
            self.assertTrue(target <= second <= target + 2, (second, target))

    def test_vitals_are_written_only_while_that_side_is_occupied(self):
        entered = {side: second for second, side, present in self.changes if present}
        left_at = {side: second for second, side, present in self.changes if not present}
        for side in ('left', 'right'):
            seconds = inserted_seconds(self.inserts, side)
            self.assertTrue(seconds, side)
            self.assertTrue(all(entered[side] <= second < left_at[side] for second in seconds), side)


class PiezoLayoutAndCadenceTest(unittest.TestCase):
    def _processor(self, records):
        records = list(records)
        for record in records:
            load_piezo_row(record, 'right')
        return StreamProcessor(records[0]), records

    def test_the_layout_comes_from_the_first_record_and_the_cadence_from_all(self):
        piezo = [r for r in scenarios.raw_records(Night(seconds=130, left=(), right=())) if r['type'] == 'piezo-dual']
        processor, records = self._processor(piezo)
        self.assertEqual((processor.piezo_layout.freq, processor.piezo_layout.sensors_per_side), (500, 2))
        self.assertIsNone(processor.cadence.ok())
        with unittest.mock.patch.object(BiometricProcessor, '_calculate_vitals', fake_vitals), \
                unittest.mock.patch.object(biometric_processor, 'insert_vitals'):
            for record in records[1:]:
                processor.process_piezo_record(record)
        self.assertTrue(processor.cadence.ok())

    def _layout_after(self, first):
        piezo = [r for r in scenarios.raw_records(Night(seconds=5, left=(), right=())) if r['type'] == 'piezo-dual']
        for record in piezo:
            load_piezo_row(record, 'right')
        processor = StreamProcessor(first)
        with unittest.mock.patch.object(BiometricProcessor, '_calculate_vitals', fake_vitals), \
                unittest.mock.patch.object(biometric_processor, 'insert_vitals'):
            for record in piezo:
                processor.process_piezo_record(record)
        return processor.piezo_layout

    def test_a_first_record_without_a_layout_waits_for_one_that_has_it(self):
        first = {'type': 'piezo-dual', 'ts': T0 - 1, 'freq': 500, 'left1': 'unreadable', 'right1': 'unreadable'}
        layout = self._layout_after(first)
        self.assertEqual((layout.freq, layout.sensors_per_side), (500, 2))

    def test_a_first_record_without_a_rate_waits_for_one_that_has_it(self):
        first = next(r for r in scenarios.raw_records(Night(seconds=1)) if r['type'] == 'piezo-dual')
        load_piezo_row(first, 'right')
        del first['freq']
        layout = self._layout_after(first)
        self.assertEqual((layout.freq, layout.sensors_per_side), (500, 2))


class ShortAbsenceTest(unittest.TestCase):
    def _first_hrv_after_return(self, gap_seconds):
        night = Night(seconds=3600, right=((100, 900), (900 + gap_seconds, 3600)))
        _, inserts = stream(night)
        back = 900 + gap_seconds + 19
        return next(hrv for side, second, hrv in inserts if side == 'right' and second >= back)

    def test_a_three_minute_absence_keeps_hrv(self):
        self.assertEqual(self._first_hrv_after_return(180), 45.0)

    def test_a_twelve_minute_absence_starts_clean(self):
        self.assertEqual(self._first_hrv_after_return(720), 0)


class DetectorSwitchTest(unittest.TestCase):
    def test_turning_the_switch_off_mid_session_hands_back_to_piezo(self):
        night = Night(seconds=1500, right=((100, 1500),))
        changes, _ = stream(night, switch_off_at=600)
        self.assertEqual([change[1:] for change in changes[:3]], [('right', True), ('right', False), ('right', True)])
        self.assertEqual(changes[1][0], 600)
        # The piezo detector then finds her again within its own entry time.
        self.assertLess(changes[2][0], 620)

    def test_new_calibration_waits_for_an_empty_bed(self):
        processor = StreamProcessor(
            next(record for record in scenarios.raw_records(Night(seconds=1)) if record['type'] == 'piezo-dual'))
        with unittest.mock.patch.object(BiometricProcessor, '_update_presence_api', lambda *a: None):
            processor.use_presence_v2((PARAMS, BASELINES))
            detector = processor.presence
            for second in range(30):
                detector.step(T0 + second, {'left': 20.0, 'right': 0.0}, {'left': 1e6, 'right': 1e6})
            newer = DetectorParams(left=PARAMS.left, right=PARAMS.right, piezo_floor={'left': 50_000.0, 'right': 50_000.0})
            processor.use_presence_v2((newer, BASELINES))
            self.assertIs(processor.presence, detector)
            for second in range(30, 200):
                detector.step(T0 + second, {'left': 0.0, 'right': 0.0}, {'left': 10_000.0, 'right': 10_000.0})
            processor.use_presence_v2((newer, BASELINES))
            self.assertIsNot(processor.presence, detector)


class FullSwapTest(unittest.TestCase):
    def test_trading_sides_starts_both_clean(self):
        night = Night(seconds=2400, left=((100, 800), (1000, 2400)), right=((100, 900), (1100, 2400)))
        changes, inserts = stream(night)
        entries = [(second, side) for second, side, present in changes if present]
        self.assertEqual([side for _, side in entries], ['left', 'right', 'left', 'right'])
        for second, side in entries[2:]:
            first = next(hrv for row_side, row_second, hrv in inserts if row_side == side and row_second >= second)
            self.assertEqual(first, 0, side)


class OutOfOrderRecordTest(unittest.TestCase):
    def test_repeated_and_backward_seconds_do_not_restart_the_entry(self):
        night = Night(seconds=400, right=((100, 400),))
        records = []
        for record in scenarios.raw_records(night):
            records.append(record)
            second = record['ts'] - T0
            if record['type'] == 'piezo-dual' and 90 <= second <= 140 and second % 5 == 0:
                records.append(dict(record))
                records.append(dict(record, ts=record['ts'] - 3))
        changes, _ = stream(night, records=records)
        self.assertEqual(changes[0][1:], ('right', True))
        self.assertLessEqual(changes[0][0], 121)

    def test_a_clock_step_back_does_not_freeze_presence(self):
        night = Night(seconds=600, right=((100, 300),))
        records = [dict(record, ts=record['ts'] - 3600) if record['ts'] - T0 >= 200 else record
                   for record in scenarios.raw_records(night)]
        changes, _ = stream(night, records=records)
        self.assertEqual([change[1:] for change in changes], [('right', True), ('right', False)])


LEGACY_PROFILES = {
    side: {'cap': scenarios.legacy_cap_payload(side, delta_noise=2.0), 'cap_occupied': {'level': level},
           'piezo_floors': [40_000.0]}
    for side, level in (('left', 1000.0), ('right', 500.0))
}
LEGACY_INPUTS = (params_from_calibration(LEGACY_PROFILES, CAPSENSE), baselines_from_calibration(LEGACY_PROFILES), CAPSENSE)
# Counts far too small for the learned levels: the bed is in use and capacitance places nobody in it.
MISFIT = Night(seconds=1500, left=((0, 1500),), right=((0, 1500),))


def legacy_records(night: Night, counts_per_unit: float = 50.0):
    return list(scenarios.legacy_raw_records(night, counts_per_unit))


class LegacyLiveTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        records = legacy_records(scenarios.STAGGERED)
        cls.staggered = run_live(records, LEGACY_INPUTS)
        cls.staggered_off = run_live(records, None)

    def test_each_side_follows_its_own_person_on_capsense(self):
        self.assertEqual([change[1:] for change in self.staggered.held],
                         [('right', True), ('left', True), ('left', False), ('right', False)])
        self.assertIsNotNone(self.staggered.processor.presence)

    def test_vitals_follow_the_capacitance_sessions(self):
        entered = {side: second for second, side, present in self.staggered.held if present}
        left_at = {side: second for second, side, present in self.staggered.held if not present}
        for side in ('left', 'right'):
            seconds = inserted_seconds(self.staggered.inserts, side)
            self.assertTrue(seconds, side)
            self.assertTrue(all(entered[side] <= second < left_at[side] for second in seconds), side)

    def test_the_server_hears_exactly_what_it_hears_with_the_switch_off(self):
        # Presence auto-off reads only these posts.
        self.assertTrue(any(present for _, _, present in self.staggered_off.posts))
        self.assertEqual(self.staggered.posts, self.staggered_off.posts)

    def test_turning_on_and_off_mid_night_leaves_the_server_on_piezo(self):
        night = Night(seconds=4000, left=((300, 3500),), right=((600, 3800),))
        records = legacy_records(night)
        switched = run_live(records, LEGACY_INPUTS, switch_on_at=1000, switch_off_at=2500)
        self.assertEqual(switched.posts, run_live(records, None).posts)
        self.assertIsNone(switched.processor.presence)
        self.assertIsNone(switched.processor._piezo_presence)

    def test_capacitance_that_misses_the_bed_hands_back_to_piezo_and_stays_there(self):
        with self.assertLogs(stream_processor_module.logger, level='WARNING') as logs:
            run = run_live(legacy_records(MISFIT, 1.0), LEGACY_INPUTS)
        processor = run.processor
        self.assertIsNone(processor.presence)
        self.assertIsNone(processor._piezo_presence)
        self.assertTrue(any('back on the vibration sensor' in line for line in logs.output))
        processor.use_presence_v2(LEGACY_INPUTS)
        self.assertIsNone(processor.presence)
        changed = dict(LEGACY_PROFILES, left=dict(LEGACY_PROFILES['left'], cap_occupied={'level': 900.0}))
        processor.use_presence_v2((params_from_calibration(changed, CAPSENSE), LEGACY_INPUTS[1], CAPSENSE))
        self.assertIsNotNone(processor.presence)

    def test_the_hand_back_keeps_the_server_on_piezo(self):
        records = legacy_records(MISFIT, 1.0)
        with self.assertLogs(stream_processor_module.logger, level='WARNING'):
            run = run_live(records, LEGACY_INPUTS)
        self.assertEqual(run.posts, run_live(records, None).posts)

    def test_new_calibration_keeps_the_piezo_detector_running(self):
        processor = StreamProcessor(legacy_records(Night(seconds=1))[0], cap_source=LatestCap())
        processor.use_presence_v2(LEGACY_INPUTS)
        piezo, detector = processor._piezo_presence, processor.presence
        changed = dict(LEGACY_PROFILES, right=dict(LEGACY_PROFILES['right'], cap_occupied={'level': 600.0}))
        processor.use_presence_v2((params_from_calibration(changed, CAPSENSE), LEGACY_INPUTS[1], CAPSENSE))
        self.assertIsNot(processor.presence, detector)
        self.assertIs(processor._piezo_presence, piezo)
        self.assertIsNotNone(processor._guard)

    def test_capsense2_never_gets_a_guard(self):
        processor = StreamProcessor(next(iter(scenarios.raw_records(Night(seconds=1)))), cap_source=LatestCap())
        processor.use_presence_v2((PARAMS, BASELINES))
        self.assertIsNotNone(processor.presence)
        self.assertIsNone(processor._guard)
        self.assertIsNone(processor._piezo_presence)

    def test_a_change_of_format_starts_over(self):
        processor = StreamProcessor(next(iter(scenarios.raw_records(Night(seconds=1)))), cap_source=LatestCap())
        with unittest.mock.patch.object(BiometricProcessor, '_update_presence_api', lambda *args: None):
            processor.use_presence_v2((PARAMS, BASELINES))
            processor.use_presence_v2(LEGACY_INPUTS)
            self.assertIsNotNone(processor._guard)
            self.assertIsNotNone(processor._piezo_presence)
            processor.use_presence_v2((PARAMS, BASELINES))
        self.assertIsNone(processor._guard)
        self.assertIsNone(processor._piezo_presence)


class LatestCapFreshnessTest(unittest.TestCase):
    def test_recent_readings_are_fresh(self):
        cap = LatestCap()
        cap.update(1000, [1.0], [1.0])
        self.assertTrue(cap.is_fresh(1000, 60))
        self.assertTrue(cap.is_fresh(1060, 60))
        self.assertFalse(cap.is_fresh(1061, 60))

    def test_a_small_clock_lead_is_tolerated(self):
        cap = LatestCap()
        cap.update(1003, [1.0], [1.0])
        self.assertTrue(cap.is_fresh(1000, 60))

    def test_a_reading_stamped_well_ahead_is_not_fresh(self):
        cap = LatestCap()
        cap.update(1000 + 3600, [1.0], [1.0])
        self.assertFalse(cap.is_fresh(1000, 60))

    def test_no_reading_is_not_fresh(self):
        self.assertFalse(LatestCap().is_fresh(1000, 60))


class SideSwapTest(unittest.TestCase):
    def setUp(self):
        self.left = BiometricProcessor(side='left')
        self.right = BiometricProcessor(side='right')

    def test_partner_moving_across_is_a_swap(self):
        self.left.last_exit_at = 1000
        self.right.last_exit_at = 1900
        self.assertTrue(is_side_swap(self.left, self.right, 2000))

    def test_returning_after_the_partner_left_long_ago_is_not(self):
        self.left.last_exit_at = 1900
        self.right.last_exit_at = 1000
        self.assertFalse(is_side_swap(self.left, self.right, 2000))
        self.left.last_exit_at = 100
        self.assertFalse(is_side_swap(self.left, self.right, 2000))

    def test_an_exit_after_the_entry_is_not(self):
        # The clock stepped back after the partner left.
        self.left.last_exit_at = 1000
        self.right.last_exit_at = 2100
        self.assertFalse(is_side_swap(self.left, self.right, 2000))

    def test_partner_still_in_bed_is_not(self):
        self.right.present = True
        self.right.last_exit_at = 1990
        self.assertFalse(is_side_swap(self.left, self.right, 2000))


if __name__ == '__main__':
    unittest.main()
