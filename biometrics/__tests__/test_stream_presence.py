"""The live stream with the capacitance detector in charge: presence per
side follows each person, vitals are written only while that side is
occupied, and vitals state survives a short trip out of bed."""
import logging
import os
import sys
import types
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
from biometric_processor import BiometricProcessor, _PresenceCoordinator
from load_raw_files import load_piezo_row
from presence.cap import CapBaseline
from presence.detector import DetectorParams, SideParams
from presence.sensors import read_cap
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


def stream(night: Night, inputs=(PARAMS, BASELINES), switch_off_at=None, records=None):
    """Feed a night through StreamProcessor as the stream does; returns (transitions, inserts)."""
    _PresenceCoordinator._latest = {'left': 0.0, 'right': 0.0}
    posts, inserts = [], []
    now = [T0]

    def capture_post(processor, present):
        posts.append((now[0] - T0, processor.side, present))

    latest = LatestCap()
    with unittest.mock.patch.object(BiometricProcessor, '_update_presence_api', capture_post), \
            unittest.mock.patch.object(BiometricProcessor, '_calculate_vitals', fake_vitals), \
            unittest.mock.patch.object(biometric_processor, 'insert_vitals',
                                       side_effect=lambda row: inserts.append((row['side'], row['timestamp'] - T0, row['hrv']))):
        processor = None
        for record in records if records is not None else scenarios.raw_records(night):
            reading = read_cap(record)
            if reading is not None:
                if reading.left is not None and reading.right is not None:
                    latest.update(record['ts'], reading.left, reading.right, reading.cap_format)
                continue
            load_piezo_row(record, 'right')
            now[0] = record['ts']
            if processor is None:
                processor = StreamProcessor(record, cap_source=latest)
                processor.use_presence_v2(inputs)
                continue
            if switch_off_at is not None and record['ts'] - T0 == switch_off_at:
                processor.use_presence_v2(None)
            processor.process_piezo_record(record)
    return transitions(posts), inserts


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
