"""Estimator state outlives short presence exits; rows only for minutes a side was present."""
import os
import sys
import unittest
import unittest.mock

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))

import stream_fixture
from buffer import Buffer
from presence.piezo import PiezoLayout
import vitals2_stream
from vitals2_stream import (ABSENCE_RESET_SECONDS, BATCH_PHASE_SECONDS, CAP_MAX_AGE_SECONDS, PUMP_HIGH_RPM,
                            PUMP_STALE_SECONDS, PumpSpeed, Vitals2Stream)
from vitals2 import hr, hrv
from vitals2.rows import minute_row
from vitals2_synth import bcg, breathing, noise, piezo

LAYOUT = PiezoLayout(freq=500, samples=500, sensors_per_side=1)
START = stream_fixture.START


def drive(stream, buffer, left, start_second, seconds, left_present, layout=LAYOUT, right=None, right_present=False,
          cap_age=0, pump=None):
    """Feed one-second records; present and cap_age may be callables of the second."""
    rows = []
    for second in range(start_second, start_second + seconds):
        window = slice(second * 500, (second + 1) * 500)
        epoch = START + second
        other = left[window] // 50 if right is None else right[window]
        buffer.append({'ts': epoch, 'left1': left[window], 'right1': other})
        if pump is not None and second % 10 == 0:
            pump.note(_frame(epoch, pump_rpm(second)))
        present = {'left': left_present(second) if callable(left_present) else left_present,
                   'right': right_present(second) if callable(right_present) else right_present}
        age = cap_age(second) if callable(cap_age) else cap_age
        for row in stream.step(epoch, layout, buffer, present, cap_age=age):
            rows.append(dict(row, written=epoch))
    return rows


def _frame(epoch, rpm):
    return {'type': 'frzHealth', 'ts': epoch,
            'left': {'pump': {'mode': 'pwm', 'rpm': rpm, 'water': True}},
            'right': {'pump': {'mode': 'pwm', 'rpm': rpm, 'water': True}}}


# The priming run seen in our own frzHealth frames: about 3000 rpm against about 1950 at rest.
HIGH_FROM, HIGH_UNTIL = 200, 270


def pump_rpm(second):
    return 3040 if HIGH_FROM <= second < HIGH_UNTIL else 1950


class Recorder:
    """Wraps minute_row to keep every minute's inputs the stream handed it."""

    def __init__(self):
        # A minute may be built twice (before and after its HRV); keep the last.
        self.calls = {}

    def __call__(self, side, minute, hr_windows, resp_windows, variability):
        self.calls[(side, minute)] = (list(hr_windows), list(resp_windows), variability)
        return minute_row(side, minute, hr_windows, resp_windows, variability)

    def windows(self, side='left'):
        return [window for key, call in self.calls.items() if key[0] == side for window in call[0]]

    def breaths(self, side='left'):
        return [window for key, call in self.calls.items() if key[0] == side for window in call[1]]


class Vitals2StreamStateTest(unittest.TestCase):
    def setUp(self):
        self.left = piezo(1500, bpm=60, per_minute=15, jitter_ms=20, seed=4)
        self.buffer = Buffer(3, 30, 300)
        self.stream = Vitals2Stream()

    def test_no_layout_or_no_rate_gives_no_rows(self):
        self.assertEqual(drive(self.stream, self.buffer, self.left, 0, 200, True, layout=None), [])
        no_rate = PiezoLayout(freq=None, samples=500, sensors_per_side=1)
        self.assertEqual(drive(self.stream, self.buffer, self.left, 200, 200, True, layout=no_rate), [])
        self.assertEqual(self.stream.sides['left'].hr_windows, {})
        # Presence was still tracked, so the side is active once a rate arrives.
        self.assertTrue(drive(self.stream, self.buffer, self.left, 400, 200, True))

    def test_a_minute_is_written_once_its_windows_are_final(self):
        rows = drive(self.stream, self.buffer, self.left, 0, 420, True)
        self.assertGreaterEqual(len(rows), 4)
        for row in rows:
            self.assertEqual(row['timestamp'] % 60, 0)
            self.assertEqual(row['written'] - row['timestamp'], 60 + BATCH_PHASE_SECONDS)
            self.assertLessEqual(abs(row['heart_rate'] - 60), 1)
        stamps = [row['timestamp'] for row in rows]
        self.assertEqual(stamps, list(range(stamps[0], stamps[-1] + 1, 60)))

    def test_records_longer_than_a_second_still_give_ten_second_windows(self):
        # Two-second records: 1000 samples at 500 Hz.
        two_second = PiezoLayout(freq=500, samples=1000, sensors_per_side=1)
        left = piezo(600, bpm=60, per_minute=15, jitter_ms=20, seed=5)
        rows = []
        for index in range(300):
            window = slice(index * 1000, (index + 1) * 1000)
            epoch = START + 2 * index
            self.buffer.append({'ts': epoch, 'left1': left[window], 'right1': left[window] // 50})
            rows += self.stream.step(epoch, two_second, self.buffer, {'left': True, 'right': False}, cap_age=0)
        self.assertGreaterEqual(len(rows), 6)
        self.assertTrue(all(abs(row['heart_rate'] - 60) <= 1 for row in rows))

    def test_reset_side_clears_that_side_only(self):
        drive(self.stream, self.buffer, self.left, 0, 400, True)
        self.assertIsNotNone(self.stream.sides['left'].template)
        self.stream.sides['right'].last_present = START + 399
        self.stream.reset_side('left')
        self.assertIsNone(self.stream.sides['left'].template)
        self.assertIsNone(self.stream.sides['left'].last_present)
        self.assertIsNotNone(self.stream.sides['right'].last_present)

    def test_no_rows_while_absent_and_state_survives_a_short_exit(self):
        drive(self.stream, self.buffer, self.left, 0, 400, True)
        tracker, template = self.stream.sides['left'].tracker, self.stream.sides['left'].template
        self.assertIsNotNone(template)
        absent = drive(self.stream, self.buffer, self.left, 400, 120, False)
        self.assertTrue(all(row['timestamp'] < START + 400 for row in absent))
        self.assertIs(self.stream.sides['left'].tracker, tracker)
        self.assertIs(self.stream.sides['left'].template, template)
        rows = drive(self.stream, self.buffer, self.left, 520, 400, True)
        self.assertTrue(rows)
        # HRV comes back once five minutes in bed follow the return.
        for row in rows:
            self.assertEqual(row['rmssd'] is not None, row['written'] - START >= 520 + hrv.WINDOW_SECONDS, row)
        self.assertIsNotNone(rows[-1]['rmssd'])

    def test_the_absence_reset_matches_the_legacy_processors(self):
        from biometric_processor import VITALS_RESET_ABSENCE_SECONDS
        self.assertEqual(ABSENCE_RESET_SECONDS, VITALS_RESET_ABSENCE_SECONDS)

    def test_long_absence_resets_the_side(self):
        drive(self.stream, self.buffer, self.left, 0, 400, True)
        tracker = self.stream.sides['left'].tracker
        drive(self.stream, self.buffer, self.left, 400, ABSENCE_RESET_SECONDS + 60, False)
        state = self.stream.sides['left']
        self.assertIsNone(state.template)
        self.assertIsNot(state.tracker, tracker)
        self.assertEqual(state.hr_windows, {})

    def test_the_partner_heart_on_a_present_empty_side_stays_with_the_partner(self):
        heart = bcg(600, 62, jitter_ms=25, seed=7, modulation=0.3)
        left = np.round(heart + breathing(600, 14) + noise(600, seed=8) + 400_000).astype(np.int32)
        right = np.round(0.35 * heart + noise(600, seed=9) + 300_000).astype(np.int32)
        rows = drive(self.stream, self.buffer, left, 0, 600, True, right=right, right_present=True)
        mine = [row for row in rows if row['side'] == 'left']
        theirs = [row for row in rows if row['side'] == 'right']
        self.assertGreaterEqual(len(mine), 7)
        self.assertLessEqual(len(theirs), 1)

    def test_an_empty_side_costs_nothing(self):
        drive(self.stream, self.buffer, self.left, 0, 120, False)
        self.assertEqual(self.stream.sides['left'].hr_windows, {})
        self.assertEqual(self.stream.sides['right'].hr_windows, {})

    def test_a_long_gap_still_writes_the_minute_before_it(self):
        before = drive(self.stream, self.buffer, self.left, 0, 400, True)
        self.assertNotIn(START + 300, [row['timestamp'] for row in before])
        # The first batch after it waits for enough contiguous signal.
        after = drive(self.stream, self.buffer, self.left, 400 + hr.RESET_GAP_SECONDS + 100, 30, True)
        self.assertIn(START + 300, [row['timestamp'] for row in after])

    def test_a_side_found_empty_after_a_long_gap_still_writes_the_minute_before_it(self):
        before = drive(self.stream, self.buffer, self.left, 0, 400, True)
        self.assertNotIn(START + 300, [row['timestamp'] for row in before])
        tracker = self.stream.sides['left'].tracker
        resume = 400 + ABSENCE_RESET_SECONDS + 100
        after = drive(self.stream, self.buffer, self.left, resume, 30, False)
        self.assertEqual([(row['timestamp'], row['written']) for row in after], [(START + 300, START + resume)])
        self.assertLessEqual(abs(after[0]['heart_rate'] - 60), 1)
        self.assertIsNot(self.stream.sides['left'].tracker, tracker)
        self.assertEqual(self.stream.sides['left'].hr_windows, {})


class OccupancyTest(unittest.TestCase):
    """Every window is read from one stay in bed, never from before a swap or across an absence."""

    def spy(self, stream):
        """(side, window end, estimate) for each HRV the stream computes."""
        seen = []
        real = stream._variability

        def variability(epoch, clock, buffer, side, available, end, minute, bpm):
            out = real(epoch, clock, buffer, side, available, end, minute, bpm)
            if out is not None and out.rmssd is not None:
                seen.append((side, end - START, out))
            return out
        stream._variability = variability
        return seen

    def assert_windows_inside(self, recorder, seen, stays):
        def inside(start, end):
            return any(first <= start and end <= last for first, last in stays)
        for window in recorder.windows():
            if window.usable:
                start = window.timestamp - START
                self.assertTrue(inside(start, start + hr.WINDOW_SECONDS), window)
        for breath in recorder.breaths():
            centre = breath.timestamp - START
            self.assertTrue(inside(centre - 30, centre + 30), breath)
        for side, end, _ in seen:
            if side == 'left':
                self.assertTrue(inside(end - hrv.WINDOW_SECONDS, end), end)

    def test_a_newcomer_after_a_swap_never_gets_the_previous_occupants_variability(self):
        swap, seconds = 400, 1100
        before = piezo(seconds, bpm=60, per_minute=15, jitter_ms=60, seed=11)
        after = piezo(seconds, bpm=60, per_minute=15, jitter_ms=0, seed=12)
        left = np.where(np.arange(seconds * 500) < swap * 500, before, after).astype(np.int32)
        stream, buffer, recorder = Vitals2Stream(), Buffer(3, 30, 300), Recorder()
        seen = self.spy(stream)
        with unittest.mock.patch.object(vitals2_stream, 'minute_row', recorder):
            drive(stream, buffer, left, 0, swap, True)
            # As the stream processor does when presence reports a swap.
            stream.flush(START + swap, LAYOUT)
            stream.reset_side('left')
            stream.reset_side('right')
            drive(stream, buffer, left, swap, seconds - swap, True)
        newcomer = [(end, estimate) for side, end, estimate in seen if side == 'left' and end > swap]
        self.assertTrue(newcomer)
        self.assertGreaterEqual(min(end for end, _ in newcomer), swap + hrv.WINDOW_SECONDS)
        # The newcomer's beats are regular; the previous occupant's varied by 60 ms.
        self.assertTrue(all(estimate.rmssd < 15 for _, estimate in newcomer), newcomer)
        self.assertTrue(any(estimate.rmssd > 40 for side, end, estimate in seen if end <= swap))
        self.assertTrue(recorder.breaths())
        self.assert_windows_inside(recorder, seen, [(0, swap), (swap, seconds)])

    def test_an_absence_with_the_partners_heart_on_the_empty_side_is_never_read(self):
        away, back, seconds = 400, 520, 1200
        mine = bcg(seconds, 60, jitter_ms=25, seed=13, modulation=0.3)
        partner = bcg(seconds, 75, jitter_ms=25, seed=14, modulation=0.3)
        in_bed = mine + breathing(seconds, 14) + noise(seconds, seed=15)
        empty = 0.3 * partner + noise(seconds, seed=16)
        t = np.arange(seconds * 500) / 500
        left = np.round(np.where((t >= away) & (t < back), empty, in_bed) + 400_000).astype(np.int32)
        right = np.round(partner + breathing(seconds, 17) + noise(seconds, seed=17) + 300_000).astype(np.int32)
        stream, buffer, recorder = Vitals2Stream(), Buffer(3, 30, 300), Recorder()
        seen = self.spy(stream)
        with unittest.mock.patch.object(vitals2_stream, 'minute_row', recorder):
            drive(stream, buffer, left, 0, seconds, lambda s: not away <= s < back, right=right, right_present=True)
        returned = [(end, estimate) for side, end, estimate in seen if side == 'left' and end > away]
        self.assertTrue(returned)
        self.assertGreaterEqual(min(end for end, _ in returned), back + hrv.WINDOW_SECONDS)
        # The sleeper's intervals vary by 25 ms; the partner's heart read as theirs gives about 100.
        self.assertTrue(all(estimate.sdnn < 40 for _, estimate in returned), returned)
        self.assert_windows_inside(recorder, seen, [(0, away), (back, seconds)])


class ClockStepBackTest(unittest.TestCase):
    STEP = 1800

    def run_night(self, step_at=400, seconds=1100):
        left = piezo(seconds, bpm=60, per_minute=15, jitter_ms=20, seed=4)
        buffer, rows = Buffer(3, 30, 300), []
        self.stream = stream = Vitals2Stream()
        for second in range(seconds):
            window = slice(second * 500, (second + 1) * 500)
            epoch = START + second - (self.STEP if second >= step_at else 0)
            buffer.append({'ts': epoch, 'left1': left[window], 'right1': left[window] // 50})
            rows += [dict(row, written=second) for row in
                     stream.step(epoch, LAYOUT, buffer, {'left': True, 'right': False}, cap_age=0)]
        return rows

    def test_the_estimators_start_over_after_a_long_step_back(self):
        rows = self.run_night()
        # The last full minute before the step still comes out, when the step is seen.
        self.assertIn((START + 300, 400), [(row['timestamp'], row['written']) for row in rows])
        after = [row for row in rows if row['timestamp'] < START]
        # Rows again within a few minutes of the step, not once the clock has caught up.
        self.assertGreaterEqual(len(after), 6)
        self.assertLess(min(row['written'] for row in after), 400 + 240)
        self.assertTrue(all(abs(row['heart_rate'] - 60) <= 1 for row in after))
        self.assertTrue(any(row['resp_rate'] is not None for row in after))
        # The unfed pump grace counts from the new clock.
        self.assertEqual(self.stream.first_epoch, START + 400 - self.STEP)


class CapacitanceGateTest(unittest.TestCase):
    """Only capacitance presence decides a side; without a current reading nothing is written."""

    def setUp(self):
        self.left = piezo(800, bpm=60, per_minute=15, jitter_ms=20, seed=4)
        self.buffer = Buffer(3, 30, 300)
        self.stream = Vitals2Stream()

    def test_no_capacitance_reading_writes_nothing_and_says_so_once(self):
        with self.assertLogs(vitals2_stream.logger, 'WARNING') as logs:
            rows = drive(self.stream, self.buffer, self.left, 0, 420, True, cap_age=None)
        self.assertEqual(rows, [])
        self.assertEqual(len(logs.records), 1)
        self.assertEqual(self.stream.sides['left'].hr_windows, {})

    def test_a_reading_older_than_the_limit_writes_nothing(self):
        stale = drive(self.stream, self.buffer, self.left, 0, 420, True, cap_age=CAP_MAX_AGE_SECONDS + 1)
        self.assertEqual(stale, [])
        fresh = drive(Vitals2Stream(), Buffer(3, 30, 300), self.left, 0, 420, True, cap_age=CAP_MAX_AGE_SECONDS)
        self.assertTrue(fresh)

    def test_windows_ending_while_the_side_is_unknown_or_empty_are_not_used(self):
        stale = range(250, 280)
        empty = range(400, 420)
        recorder = Recorder()
        with unittest.mock.patch.object(vitals2_stream, 'minute_row', recorder):
            drive(self.stream, self.buffer, self.left, 0, 720, lambda s: s not in empty,
                  cap_age=lambda s: None if s in stale else 2)
        windows = recorder.windows()
        self.assertTrue(windows)
        for window in windows:
            # Every record the window reads decides it.
            first = window.timestamp - START
            seconds = set(range(first, first + hr.WINDOW_SECONDS))
            self.assertEqual(window.usable, not seconds & (set(stale) | set(empty)), window)
        self.assertTrue(recorder.breaths())
        for breath in recorder.breaths():
            centre = breath.timestamp - START
            for second in range(centre - 30, centre + 30):
                self.assertNotIn(second, stale)
                self.assertNotIn(second, empty)

    def test_each_window_reaches_the_minute_rule_with_its_movement(self):
        recorder = Recorder()
        seen = []
        real_step = hr.HrTracker.step

        def step(tracker, *args, **kwargs):
            found = real_step(tracker, *args, **kwargs)
            seen.extend(found)
            return found
        with unittest.mock.patch.object(vitals2_stream, 'minute_row', recorder), \
                unittest.mock.patch.object(hr.HrTracker, 'step', step):
            drive(self.stream, self.buffer, self.left, 0, 420, True)
        motion = {window.start: window.motion for window in seen}
        windows = recorder.windows()
        self.assertTrue(windows)
        for window in windows:
            self.assertEqual(window.motion, motion[window.timestamp])

    def test_windows_ending_inside_a_data_gap_are_not_used(self):
        recorder = Recorder()
        with unittest.mock.patch.object(vitals2_stream, 'minute_row', recorder):
            drive(self.stream, self.buffer, self.left, 0, 400, True)
            drive(self.stream, self.buffer, self.left, 520, 180, True)
        self.assertFalse(self.stream.sides['left'].occupied_at(START + 460, 1.0))
        windows = recorder.windows()
        self.assertTrue(any(window.timestamp - START > 520 and window.usable for window in windows))
        for window in windows:
            last = window.timestamp - START + hr.WINDOW_SECONDS - 1
            if 400 <= last < 520:
                self.assertFalse(window.usable, window)


class DataGapTest(unittest.TestCase):
    """Records missing from the buffer are never bridged by the signal on either side of them."""

    GAP = (400, 520)

    def test_a_gap_is_never_scored_as_signal(self):
        left = piezo(1500, bpm=60, per_minute=15, jitter_ms=20, seed=4)
        buffer, stream, recorder = Buffer(3, 30, 300), Vitals2Stream(), Recorder()
        now = {}
        breathing_at, hrv_at = [], []
        real_resp, real_jj = vitals2_stream.resp.estimate_resp, vitals2_stream.hrv.jj_intervals

        def spy_resp(*args, **kwargs):
            breathing_at.append(now['second'])
            return real_resp(*args, **kwargs)

        def spy_jj(*args, **kwargs):
            hrv_at.append(now['second'])
            return real_jj(*args, **kwargs)

        rows = []
        with unittest.mock.patch.object(vitals2_stream, 'minute_row', recorder), \
                unittest.mock.patch.object(vitals2_stream.resp, 'estimate_resp', spy_resp), \
                unittest.mock.patch.object(vitals2_stream.hrv, 'jj_intervals', spy_jj):
            for second in list(range(0, self.GAP[0])) + list(range(self.GAP[1], 900)):
                now['second'] = second
                window = slice(second * 500, (second + 1) * 500)
                buffer.append({'ts': START + second, 'left1': left[window], 'right1': left[window] // 50})
                rows += [dict(row, written=START + second) for row in
                         stream.step(START + second, LAYOUT, buffer, {'left': True, 'right': False}, cap_age=0)]
        after = self.GAP[1]
        # The tracker fills the missing stretch with windows that carry no rate.
        starts = {window.timestamp - START for window in recorder.windows()}
        self.assertTrue(set(range(self.GAP[0], after, hr.HOP_SECONDS)) <= starts)
        for window in recorder.windows():
            start = window.timestamp - START
            if window.value is not None:
                self.assertTrue(start + hr.WINDOW_SECONDS <= self.GAP[0] or start >= after, window)
        # Each pass reads the buffer up to the record just added.
        for second in breathing_at:
            self.assertFalse(second >= after and second + 1 - vitals2_stream.RESP_SECONDS < after, second)
        for second in hrv_at:
            self.assertFalse(second >= after and second + 1 - hrv.WINDOW_SECONDS < after, second)
        # HRV waits for five contiguous minutes, then comes back.
        self.assertTrue(any(second >= after for second in hrv_at))
        self.assertTrue(any(row['rmssd'] is not None and row['written'] - START >= after for row in rows))
        stamps = [row['timestamp'] - START for row in rows]
        self.assertNotIn(480, stamps)
        self.assertTrue(any(stamp >= after for stamp in stamps))


class RecordStepTest(unittest.TestCase):
    """Only a forward step of more than 1.5 record lengths is a gap in the records."""

    def contiguous(self, stamps, record_seconds=1.0):
        buffer = Buffer(3, 30, 300)
        for ts in stamps:
            buffer.append({'ts': ts, 'left1': np.zeros(500), 'right1': np.zeros(500)})
        return vitals2_stream._contiguous_records(buffer, record_seconds)

    def test_a_repeated_or_earlier_stamp_is_not_a_gap(self):
        before, after = list(range(START, START + 10)), list(range(START + 10, START + 20))
        self.assertEqual(self.contiguous(before + [START + 9] + after), 21)
        self.assertEqual(self.contiguous(before + [START + 4] + after), 21)

    def test_a_forward_step_over_one_and_a_half_records_is_a_gap(self):
        self.assertEqual(self.contiguous([START, START + 1, START + 2, START + 4, START + 5]), 2)
        self.assertEqual(self.contiguous([START, START + 2, START + 4], record_seconds=2.0), 3)
        self.assertEqual(self.contiguous([START, START + 2, START + 5.5], record_seconds=2.0), 1)
        self.assertEqual(self.contiguous([START, None, START + 1, START + 2]), 2)


class PumpTest(unittest.TestCase):
    def test_pump_speed_spans_from_frames(self):
        pump = PumpSpeed()
        self.assertFalse(pump.high_during(0, 10_000))
        pump.note(_frame(100, 1950))
        pump.note(_frame(110, PUMP_HIGH_RPM))
        # Fast until a slower frame, or until frames stop coming for a while.
        self.assertTrue(pump.high_during(110 + PUMP_STALE_SECONDS - 1, 5_010))
        self.assertFalse(pump.high_during(110 + PUMP_STALE_SECONDS, 5_010))
        pump.note(_frame(120, 3000))
        pump.note(_frame(130, 1900))
        self.assertFalse(pump.high_during(80, 100))
        self.assertTrue(pump.high_during(95, 101))
        self.assertTrue(pump.high_during(125, 135))
        self.assertFalse(pump.high_during(130, 200))
        # A replayed older frame changes nothing; a frame without readings neither.
        pump.note(_frame(115, 3000))
        pump.note({'type': 'frzHealth', 'ts': 140, 'left': {}, 'right': {}})
        pump.note({'type': 'frzHealth', 'ts': 'soon', 'left': {'pump': {'rpm': 3000}}})
        self.assertFalse(pump.high_during(130, 200))
        one_side = _frame(150, 1950)
        one_side['right']['pump']['rpm'] = 3100
        pump.note(one_side)
        self.assertTrue(pump.high_during(145, 150))

    def test_a_long_step_back_of_the_clock_starts_the_history_over(self):
        pump = PumpSpeed()
        for stamp in range(1000, 1100, 10):
            pump.note(_frame(stamp, 1900))
        # The record clock steps back an hour; the pump then runs fast on the new clock.
        for stamp in range(1000 - 3600, 1000 - 3600 + 30, 10):
            pump.note(_frame(stamp, 1900))
        for stamp in range(1000 - 3600 + 30, 1000 - 3600 + 60, 10):
            pump.note(_frame(stamp, 3000))
        self.assertTrue(pump.fed)
        self.assertTrue(pump.high_during(1000 - 3600 + 40, 1000 - 3600 + 60))
        self.assertFalse(pump.high_during(1000 - 3600, 1000 - 3600 + 20))

    def test_a_small_step_back_is_still_a_replayed_frame(self):
        pump = PumpSpeed()
        pump.note(_frame(1000, 1900))
        pump.note(_frame(1000 - vitals2_stream.CLOCK_STEP_BACK_SECONDS, 3000))
        self.assertFalse(pump.high_during(0, 5_000))

    def test_the_pump_and_the_stream_step_back_at_the_same_size(self):
        import pump_speed
        self.assertEqual(pump_speed.CLOCK_STEP_BACK_SECONDS, vitals2_stream.CLOCK_STEP_BACK_SECONDS)

    def test_replayed_frames_carry_their_stamp_as_text(self):
        pump = PumpSpeed()
        fast = _frame(0, 3000)
        # 1_790_600_400 is 2026-09-28 13:00:00 UTC.
        fast['ts'] = '2026-09-28 13:00:00'
        pump.note(fast)
        self.assertTrue(pump.high_during(START - 5, START))
        self.assertFalse(pump.high_during(START - 100, START - 20))

    def test_frame_stamps_are_read_by_the_public_service_health_reader(self):
        import pump_speed
        import service_health
        self.assertIs(pump_speed.frz_record_epoch, service_health.frz_record_epoch)
        self.assertIs(vitals2_stream.PumpSpeed, pump_speed.PumpSpeed)
        self.assertEqual(service_health.frz_record_epoch({'ts': '2026-09-28 13:00:00'}), START)

    def test_a_pump_nobody_feeds_is_reported_once_and_does_not_gate(self):
        left = piezo(800, bpm=60, per_minute=15, jitter_ms=20, seed=4)
        stream = Vitals2Stream()
        with self.assertLogs(vitals2_stream.logger, 'WARNING') as logs:
            rows = drive(stream, Buffer(3, 30, 300), left, 0, 480, True)
        self.assertTrue(rows)
        self.assertEqual(len([record for record in logs.records if 'pump' in record.getMessage()]), 1)
        fed = PumpSpeed()
        fed.note(_frame(START, 1950))
        with unittest.mock.patch.object(vitals2_stream.logger, 'warning') as warning:
            drive(Vitals2Stream(fed), Buffer(3, 30, 300), left, 0, 300, True)
        self.assertFalse([call for call in warning.call_args_list if 'pump' in str(call)])

    def test_windows_overlapping_a_fast_pump_are_dropped(self):
        left = piezo(800, bpm=60, per_minute=15, jitter_ms=20, seed=4)
        pump = PumpSpeed()
        stream = Vitals2Stream(pump)
        recorder = Recorder()
        with unittest.mock.patch.object(vitals2_stream, 'minute_row', recorder):
            rows = drive(stream, Buffer(3, 30, 300), left, 0, 720, True, pump=pump)
        # A frame says what the pump did since the one before, ten seconds earlier.
        fast = (HIGH_FROM - 10, HIGH_UNTIL)
        windows = recorder.windows()
        self.assertTrue(windows)
        for window in windows:
            begin = window.timestamp - START
            overlaps = begin < fast[1] and begin + hr.WINDOW_SECONDS > fast[0]
            self.assertEqual(window.usable, not overlaps, window)
        for breath in recorder.breaths():
            centre = breath.timestamp - START
            self.assertFalse(centre - 30 < fast[1] and centre + 30 > fast[0], breath)
        # HRV needs five clean minutes: none until the fast run has left the window.
        for row in rows:
            if row['written'] - START + 1 - hrv.WINDOW_SECONDS < fast[1]:
                self.assertIsNone(row['rmssd'])
                self.assertIsNone(row['hrv_coverage'])
        self.assertTrue(any(row['rmssd'] is not None for row in rows))


class NonFiniteTest(unittest.TestCase):
    def test_non_finite_estimates_become_empty_columns(self):
        left = piezo(800, bpm=60, per_minute=15, jitter_ms=20, seed=4)
        nan, inf = float('nan'), float('inf')
        with unittest.mock.patch.object(vitals2_stream.hrv, 'rmssd_sdnn', return_value=(nan, inf, 0.8)), \
                unittest.mock.patch.object(vitals2_stream.resp, 'estimate_resp', return_value=(nan, nan)):
            rows = drive(Vitals2Stream(), Buffer(3, 30, 300), left, 0, 480, True)
        self.assertTrue(rows)
        for row in rows:
            self.assertIsNone(row['rmssd'])
            self.assertIsNone(row['sdnn'])
            self.assertEqual(row['hrv'], 0)
            self.assertIsNone(row['resp_rate'])
            self.assertEqual(row['breathing_rate'], 0)
        self.assertTrue(any(row['hrv_coverage'] == 0.8 for row in rows))
        with unittest.mock.patch.object(vitals2_stream.hrv, 'rmssd_sdnn', return_value=(20.0, 30.0, nan)):
            rows = drive(Vitals2Stream(), Buffer(3, 30, 300), left, 0, 480, True)
        self.assertTrue(rows)
        self.assertTrue(all(row['hrv_coverage'] is None and row['rmssd'] is None for row in rows))


if __name__ == '__main__':
    unittest.main()
