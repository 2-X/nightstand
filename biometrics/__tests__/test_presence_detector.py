"""Two-sided presence: capacitance picks the side, piezo only says the bed is alive.

Every scenario below comes from a real failure: the piezo-only detector
marked a partner-only side occupied, ejected the quieter sleeper whenever the
other one moved more, and gave both sides the same night.
"""
import os
import sys
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
sys.path.insert(0, HERE)

from presence.detector import (
    BED_QUIET_SECONDS, ENTER_ALIVE_SECONDS, DetectorParams, PresenceDetector, SideParams, piezo_range,
)
import presence_scenarios as scenarios
from presence_scenarios import Night

QUIET = {'left': 10_000.0, 'right': 10_000.0}
ALIVE = {'left': 1_000_000.0, 'right': 1_000_000.0}

PARAMS = DetectorParams(
    left=SideParams(enter_delta=4.0, exit_delta=2.0),
    right=SideParams(enter_delta=4.0, exit_delta=2.0),
    piezo_floor={'left': 75_000.0, 'right': 75_000.0},
)


def run(night: Night, params: DetectorParams = PARAMS):
    """Occupied seconds per side, as offsets from the start of the night."""
    detector = PresenceDetector(params)
    occupied = {'left': [], 'right': []}
    for t, cap, piezo in scenarios.frames(night):
        state = detector.step(t, cap, piezo)
        for side in occupied:
            if state[side]:
                occupied[side].append(t - scenarios.T0)
    return detector, occupied


def replay_spans(frames, params: DetectorParams = PARAMS):
    """Occupied [start, end) spans per side for a list of frames."""
    detector = PresenceDetector(params)
    occupied = {'left': [], 'right': []}
    for t, cap, piezo in frames:
        state = detector.step(t, cap, piezo)
        for side in occupied:
            if state[side]:
                occupied[side].append(t - scenarios.T0)
    return {side: spans(seconds) for side, seconds in occupied.items()}


def spans(seconds):
    """Contiguous [start, end) runs of a sorted list of seconds."""
    result = []
    for second in seconds:
        if result and result[-1][1] == second:
            result[-1][1] = second + 1
        else:
            result.append([second, second + 1])
    return [tuple(span) for span in result]


class PartnerOnlyTest(unittest.TestCase):
    def test_the_empty_side_is_never_marked_while_only_the_partner_is_in_bed(self):
        # Right occupied all night; left sees crosstalk piezo far above any
        # noise floor plus short capacitance spikes.
        _, occupied = run(Night(seconds=6000, right=((300, 5700),)))
        self.assertEqual(occupied['left'], [])
        self.assertEqual(spans(occupied['right']), [(319, 5759)])

    def test_spikes_above_the_entry_level_but_shorter_than_the_dwell_do_not_enter(self):
        _, occupied = run(Night(seconds=6000, right=((300, 5700),), spike_cap=6.0))
        self.assertEqual(occupied['left'], [])


class DominantPartnerTest(unittest.TestCase):
    def test_the_quieter_sleeper_is_not_ejected_by_a_louder_partner(self):
        # Left moves 3.3x more than right the whole time both are in bed, and
        # right's capacitance sags to 3.3 for 20 minutes (between exit and
        # entry levels). Right must stay in bed throughout.
        night = Night(
            seconds=8000, left=((600, 7400),), right=((300, 7600),),
            overrides=(('right', 3000, 4200, 3.3),),
        )
        _, occupied = run(night)
        self.assertEqual(spans(occupied['right']), [(319, 7659)])
        self.assertEqual(spans(occupied['left']), [(619, 7459)])


class StaggeredNightTest(unittest.TestCase):
    def test_each_side_gets_its_own_entry_and_exit(self):
        _, occupied = run(scenarios.STAGGERED)
        right = spans(occupied['right'])
        left = spans(occupied['left'])
        self.assertEqual(right, [(619, 15_059)])
        self.assertEqual(left, [(1819, 13_859)])
        # Right in first, left out first.
        self.assertLess(right[0][0], left[0][0])
        self.assertLess(left[0][1], right[0][1])


class WholeBedGateTest(unittest.TestCase):
    def test_a_quiet_bed_ends_a_session_the_capacitance_would_hold(self):
        # After the real exit something keeps right's capacitance at 2.6,
        # above its exit level; the piezo shows nobody alive.
        night = Night(seconds=7000, right=((600, 4000),), overrides=(('right', 4000, 6000, 2.6),))
        _, occupied = run(night)
        self.assertEqual(spans(occupied['right']), [(619, 4000 + BED_QUIET_SECONDS - 1)])

    def test_an_object_on_an_empty_bed_never_enters(self):
        _, occupied = run(Night(seconds=4000, overrides=(('left', 1000, 2000, 6.0),)))
        self.assertEqual(occupied['left'], [])

    def test_a_learned_floor_moves_the_gate(self):
        # Pump-on idle at 130k: a 70k floor (gate 140k) sees a quiet bed and
        # ends the held session; a 40k floor (gate 80k) sees it alive.
        night = Night(seconds=4000, right=((600, 2000),), empty_piezo=130_000.0,
                      overrides=(('right', 2000, 3500, 2.6),))
        quiet_gate = DetectorParams(left=PARAMS.left, right=PARAMS.right,
                                    piezo_floor={'left': 70_000.0, 'right': 70_000.0})
        loud_gate = DetectorParams(left=PARAMS.left, right=PARAMS.right,
                                   piezo_floor={'left': 40_000.0, 'right': 40_000.0})
        _, quiet = run(night, quiet_gate)
        _, loud = run(night, loud_gate)
        self.assertEqual(spans(quiet['right']), [(619, 2000 + BED_QUIET_SECONDS - 1)])
        self.assertEqual(spans(loud['right']), [(619, 3559)])


class WindowStartTest(unittest.TestCase):
    """An analysis window can start, or frames resume, on an empty bed."""

    def _left(self, detector, seconds, delta, piezo):
        occupied = []
        for t in seconds:
            if detector.step(t, {'left': delta, 'right': 0.0}, piezo)['left']:
                occupied.append(t)
        return occupied

    def test_an_object_at_the_window_start_never_enters(self):
        detector = PresenceDetector(PARAMS)
        self.assertEqual(self._left(detector, range(0, 300), 6.0, QUIET), [])

    def test_an_object_after_a_gap_on_an_empty_bed_never_enters(self):
        detector = PresenceDetector(PARAMS)
        seconds = list(range(0, 200)) + list(range(320, 600))
        self.assertEqual(self._left(detector, seconds, 6.0, QUIET), [])

    def test_a_sleeper_at_the_window_start_enters_after_the_dwell(self):
        _, occupied = run(Night(seconds=3000, right=((0, 2000),)))
        self.assertEqual(spans(occupied['right']), [(19, 2059)])

    def test_entry_waits_for_the_bed_to_read_alive(self):
        detector = PresenceDetector(PARAMS)
        self.assertEqual(self._left(detector, range(0, 50), 10.0, QUIET), [])
        self.assertEqual(self._left(detector, range(50, 100), 10.0, ALIVE)[0], 69)

    def test_the_first_alive_second_after_a_quiet_stretch_does_not_enter_at_once(self):
        detector = PresenceDetector(PARAMS)
        self._left(detector, range(0, 200), 6.0, QUIET)
        self.assertEqual(self._left(detector, range(200, 230), 6.0, ALIVE)[0], 219)

    def test_one_alive_second_does_not_let_an_object_enter(self):
        for thump in (0, 150):
            detector = PresenceDetector(PARAMS)
            occupied = []
            for t in range(0, 300):
                piezo = ALIVE if t == thump else QUIET
                if detector.step(t, {'left': 6.0, 'right': 0.0}, piezo)['left']:
                    occupied.append(t)
            self.assertEqual(occupied, [], thump)

    def test_entry_needs_enough_alive_seconds_inside_the_enter_window(self):
        for alive_seconds, entered in ((ENTER_ALIVE_SECONDS - 1, False), (ENTER_ALIVE_SECONDS, True)):
            detector = PresenceDetector(PARAMS)
            for t in range(0, 20):
                state = detector.step(t, {'left': 10.0, 'right': 0.0}, ALIVE if t < alive_seconds else QUIET)
            self.assertEqual(state['left'], entered, alive_seconds)

    def test_a_real_entry_after_a_thump_still_enters_after_the_dwell(self):
        detector = PresenceDetector(PARAMS)
        self._left(detector, range(0, 100), 6.0, QUIET)
        self._left(detector, range(100, 101), 6.0, ALIVE)
        self._left(detector, range(101, 300), 6.0, QUIET)
        self.assertEqual(self._left(detector, range(300, 400), 10.0, ALIVE)[0], 319)

    def test_the_same_night_over_two_windows_gives_the_same_sessions(self):
        night = Night(seconds=5000, right=((600, 4000),), overrides=(('left', 0, 500, 6.0),))
        frames = scenarios.frames(night)
        whole = replay_spans(frames)
        self.assertEqual(whole, {'left': [], 'right': [(619, 4059)]})
        self.assertEqual(replay_spans(frames[250:]), whole)
        self.assertEqual(replay_spans(frames[:100] + frames[300:]), whole)

    def test_thumps_on_an_empty_bed_do_not_change_the_sessions_over_two_windows(self):
        night = Night(seconds=5000, right=((600, 4000),), overrides=(('left', 0, 500, 6.0),))
        frames = [(t, cap, ALIVE if t - scenarios.T0 in (150, 260, 400) else piezo)
                  for t, cap, piezo in scenarios.frames(night)]
        whole = replay_spans(frames)
        self.assertEqual(whole, {'left': [], 'right': [(619, 4059)]})
        self.assertEqual(replay_spans(frames[250:]), whole)
        self.assertEqual(replay_spans(frames[:100] + frames[300:]), whole)


class BaselineTrackingTest(unittest.TestCase):
    def test_slow_drift_on_an_empty_bed_is_followed(self):
        detector, occupied = run(Night(seconds=4000, overrides=(('left', 0, 4000, 1.0),)))
        self.assertEqual(occupied['left'], [])
        self.assertGreater(detector.offsets()['left'], 0.95)
        self.assertLessEqual(detector.offsets()['left'], 1.0)

    def test_a_step_as_large_as_the_exit_level_is_not_absorbed(self):
        detector, _ = run(Night(seconds=4000, overrides=(('left', 0, 4000, 2.5),)))
        self.assertEqual(detector.offsets()['left'], 0.0)

    def test_nothing_is_tracked_while_someone_is_in_bed(self):
        detector, _ = run(Night(seconds=4000, right=((0, 4000),), overrides=(('left', 0, 4000, 1.0),)))
        self.assertEqual(detector.offsets(), {'left': 0.0, 'right': 0.0})


class FrameHandlingTest(unittest.TestCase):
    def _steps(self, detector, start, count, delta, piezo=1_000_000.0):
        state = None
        for t in range(start, start + count):
            state = detector.step(t, {'left': delta, 'right': 0.0}, {'left': piezo, 'right': piezo})
        return state

    def test_missing_capacitance_holds_the_side(self):
        detector = PresenceDetector(PARAMS)
        self._steps(detector, 0, 20, 10.0)
        self.assertTrue(detector.state()['left'])
        for t in range(20, 200):
            detector.step(t, {'left': None, 'right': None}, {'left': 1e6, 'right': 1e6})
        self.assertTrue(detector.state()['left'])

    def test_missing_capacitance_keeps_an_empty_side_empty(self):
        detector = PresenceDetector(PARAMS)
        for t in range(0, 200):
            detector.step(t, {'left': None, 'right': None}, {'left': 1e6, 'right': 1e6})
        self.assertEqual(detector.state(), {'left': False, 'right': False})

    def test_a_nan_capacitance_reading_is_missing(self):
        detector = PresenceDetector(PARAMS)
        for t in range(0, 200):
            detector.step(t, {'left': float('nan'), 'right': 0.5}, {'left': 10_000.0, 'right': 10_000.0})
        self.assertEqual(detector.offsets()['left'], 0.0)
        self.assertGreater(detector.offsets()['right'], 0.0)
        state = self._steps(detector, 200, 20, 10.0)
        self.assertTrue(state['left'])

    def test_a_nan_piezo_reading_is_missing(self):
        # Counted as quiet, the NaN would empty the bed after 90 s and end the session.
        detector = PresenceDetector(PARAMS)
        self._steps(detector, 0, 20, 10.0)
        self.assertTrue(detector.state()['left'])
        for t in range(20, 320):
            state = detector.step(t, {'left': 10.0, 'right': 0.0}, {'left': float('nan'), 'right': 10_000.0})
        self.assertTrue(state['left'])

    def test_a_one_second_spike_neither_enters_nor_exits(self):
        # A saturated capacitance read (28.5 on every value) lands as one
        # huge delta; a dropped read lands as one near zero.
        detector = PresenceDetector(PARAMS)
        self._steps(detector, 0, 100, 0.0)
        state = self._steps(detector, 100, 1, 50.0)
        self.assertFalse(state['left'])
        state = self._steps(detector, 101, 100, 0.0)
        self.assertFalse(state['left'])
        self._steps(detector, 201, 20, 10.0)
        self.assertTrue(detector.state()['left'])
        state = self._steps(detector, 221, 1, 0.0)
        self.assertTrue(state['left'])
        state = self._steps(detector, 222, 100, 10.0)
        self.assertTrue(state['left'])

    def test_missing_piezo_neither_empties_nor_wakes_the_bed(self):
        detector = PresenceDetector(PARAMS)
        for t in range(0, 300):
            detector.step(t, {'left': 0.0, 'right': 0.0}, {'left': None, 'right': 10_000.0})
        state = self._steps(detector, 300, 20, 10.0)
        self.assertTrue(state['left'])

    def test_a_gap_in_frames_breaks_the_entry_dwell(self):
        detector = PresenceDetector(PARAMS)
        self._steps(detector, 0, 15, 10.0)
        state = self._steps(detector, 15 + 120, 10, 10.0)
        self.assertFalse(state['left'])
        state = self._steps(detector, 145, 10, 10.0)
        self.assertTrue(state['left'])

    def test_a_backwards_timestamp_breaks_the_entry_dwell(self):
        detector = PresenceDetector(PARAMS)
        self._steps(detector, 0, 15, 10.0)
        state = self._steps(detector, 5, 10, 10.0)
        self.assertFalse(state['left'])
        state = self._steps(detector, 15, 10, 10.0)
        self.assertTrue(state['left'])

    def test_a_repeated_timestamp_is_not_another_second(self):
        detector = PresenceDetector(PARAMS)
        for t in range(0, 15):
            for _ in range(2):
                state = detector.step(t, {'left': 10.0, 'right': 0.0}, ALIVE)
        self.assertFalse(state['left'])

    def test_state_matches_the_last_step(self):
        detector = PresenceDetector(PARAMS)
        state = self._steps(detector, 0, 20, 10.0)
        self.assertEqual(detector.state(), state)
        self.assertEqual(state, {'left': True, 'right': False})


class DetectorParamsTest(unittest.TestCase):
    def test_a_floor_that_is_not_finite_and_positive_is_rejected(self):
        for floor in (0.0, -5.0, float('nan'), float('inf'), None, True):
            with self.assertRaises(ValueError):
                DetectorParams(left=PARAMS.left, right=PARAMS.right,
                               piezo_floor={'left': floor, 'right': 75_000.0})
        with self.assertRaises(ValueError):
            DetectorParams(left=PARAMS.left, right=PARAMS.right, piezo_floor={'left': 75_000.0})

    def test_integer_and_numpy_floors_are_accepted(self):
        params = DetectorParams(left=PARAMS.left, right=PARAMS.right,
                                piezo_floor={'left': 75_000, 'right': np.float64(66_293.0)})
        self.assertEqual(params.piezo_floor['left'], 75_000)


class PiezoRangeTest(unittest.TestCase):
    def test_range_of_one_record(self):
        samples = np.array([0, 300_000] * 250, dtype=np.int32)
        self.assertEqual(piezo_range(samples), 300_000.0)

    def test_glitch_samples_are_dropped(self):
        samples = np.array([0, 300_000] * 250 + [2_147_000_000, -2_146_959_111], dtype=np.int32)
        self.assertEqual(piezo_range(samples), 300_000.0)

    def test_nothing_usable_is_none(self):
        self.assertIsNone(piezo_range(None))
        self.assertIsNone(piezo_range(np.array([], dtype=np.int32)))
        self.assertIsNone(piezo_range(np.array([2_147_000_000], dtype=np.int32)))


if __name__ == '__main__':
    unittest.main()
