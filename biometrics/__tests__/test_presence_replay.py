"""Replaying a stored night gives the same per-side intervals the live
detector would have reported, from inputs gathered record by record."""
import os
import random
import sys
import tracemalloc
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
sys.path.insert(0, HERE)

from presence.cap import CapBaseline
from presence.detector import DetectorParams, PresenceDetector, SideParams, piezo_range
from presence.replay import FrameCollector, occupied_level, replay
import presence_scenarios as scenarios
from presence_scenarios import Night

T0 = scenarios.T0
PARAMS = DetectorParams(
    left=SideParams(enter_delta=4.0, exit_delta=2.0),
    right=SideParams(enter_delta=4.0, exit_delta=2.0),
    piezo_floor={'left': 75_000.0, 'right': 75_000.0},
)
BASELINES = {side: CapBaseline(mean=scenarios.BASELINE_MEANS[side], noise=0.05) for side in ('left', 'right')}


# Allocation allowed while reading a 25 hour night back, beyond what is stored.
TRANSIENT_BUDGET_BYTES = 2_000_000


def synthetic_night(seconds: int) -> FrameCollector:
    collector = FrameCollector(BASELINES)
    left, right = ([mean for mean in scenarios.BASELINE_MEANS[side] for _ in (0, 1)] + [1.2, 1.2] for side in ('left', 'right'))
    for second in range(seconds):
        collector.add_piezo(T0 + second, 5e6, 5e6)
        collector.add_cap(T0 + second, scenarios.channels(left), scenarios.channels(right))
        collector.add_cap(T0 + second, scenarios.channels([value + 1.0 for value in left]), scenarios.channels(right))
    return collector


def read_back_peak(collector: FrameCollector) -> int:
    tracemalloc.start()
    try:
        start = tracemalloc.get_traced_memory()[0]
        collector.cap_coverage()
        for _ in collector.frames():
            pass
        return tracemalloc.get_traced_memory()[1] - start
    finally:
        tracemalloc.stop()


def with_repeats_and_stale_frames(ordered):
    """Every seventh frame repeated, then an older second with a bogus reading."""
    messy = []
    for index, frame in enumerate(ordered):
        messy.append(frame)
        if index % 7 == 0:
            messy.append(frame)
        if index % 11 == 0 and index >= 30:
            messy.append((frame[0] - 30, {'left': 999.0, 'right': 999.0}, frame[2]))
    return messy


def collect(night: Night, **kwargs) -> FrameCollector:
    collector = FrameCollector(BASELINES)
    for record in scenarios.raw_records(night, **kwargs):
        if record['type'] == 'capSense2':
            collector.add_cap(record['ts'], scenarios.channels(record['left']['values']), scenarios.channels(record['right']['values']))
        else:
            collector.add_piezo(
                record['ts'],
                piezo_range(np.frombuffer(record['left1'], dtype=np.int32)),
                piezo_range(np.frombuffer(record['right1'], dtype=np.int32)),
            )
    return collector


class ReplayTest(unittest.TestCase):
    def test_staggered_night_intervals(self):
        intervals = replay(scenarios.frames(scenarios.STAGGERED), PARAMS)
        self.assertEqual(intervals['right'], [(T0 + 619, T0 + 15_059)])
        self.assertEqual(intervals['left'], [(T0 + 1819, T0 + 13_859)])

    def test_matches_stepping_the_live_detector(self):
        night = Night(seconds=5000, left=((400, 1500), (1700, 4000)), right=((200, 4600),))
        frames = scenarios.frames(night)
        detector = PresenceDetector(PARAMS)
        live = {'left': [], 'right': []}
        for t, cap, piezo in frames:
            for side, present in detector.step(t, cap, piezo).items():
                if present:
                    live[side].append(t)
        intervals = replay(frames, PARAMS)
        for side in ('left', 'right'):
            replayed = [t for start, end in intervals[side] for t in range(start, end)]
            self.assertEqual(replayed, live[side])

    def test_a_side_still_occupied_at_the_end_closes_after_the_last_frame(self):
        intervals = replay(scenarios.frames(Night(seconds=1000, right=((100, 1000),))), PARAMS)
        self.assertEqual(intervals['right'], [(T0 + 119, T0 + 1000)])

    def test_no_frames_no_intervals(self):
        self.assertEqual(replay([], PARAMS), {'left': [], 'right': []})

    def test_repeated_and_stale_frames_are_dropped_in_any_container(self):
        ordered = scenarios.frames(scenarios.STAGGERED)
        expected = replay(ordered, PARAMS)
        messy = with_repeats_and_stale_frames(ordered)
        self.assertEqual(replay(messy, PARAMS), expected)
        self.assertEqual(replay(tuple(messy), PARAMS), expected)
        self.assertEqual(replay(iter(messy), PARAMS), expected)


class FrameCollectorTest(unittest.TestCase):
    def test_frames_carry_both_sides(self):
        frames = list(collect(scenarios.STAGGERED, end=2000).frames())
        self.assertEqual(len(frames), 2000)
        t, cap, piezo = frames[1900]
        self.assertEqual(t, T0 + 1900)
        # Each second's frame carries that second's capacitance mean.
        self.assertAlmostEqual(cap['left'], 20.0, places=3)
        self.assertAlmostEqual(cap['right'], 10.0, places=3)
        self.assertEqual(piezo, {'left': 5_000_000.0, 'right': 1_500_000.0})

    def test_replay_from_collected_records_matches_the_ideal_frames(self):
        collected = replay(collect(scenarios.STAGGERED).frames(), PARAMS)
        ideal = replay(scenarios.frames(scenarios.STAGGERED), PARAMS)
        self.assertEqual(collected, ideal)

    def test_sentinel_records_do_not_reach_the_frames(self):
        for _, cap, _ in collect(Night(seconds=1200)).frames():
            for value in cap.values():
                self.assertIsNotNone(value)
                self.assertGreater(value, -1.0)

    def test_capacitance_is_held_for_a_few_seconds_then_dropped(self):
        collector = FrameCollector(BASELINES)
        collector.add_cap(T0, scenarios.channels([12.36] * 2 + [10.99] * 2 + [15.88] * 2 + [1.2] * 2), scenarios.channels([-1.0] * 8))
        for second in range(0, 10):
            collector.add_piezo(T0 + second, 1e6, 1e6)
        caps = [cap['left'] for _, cap, _ in collector.frames()]
        self.assertEqual([value is not None for value in caps], [True] * 6 + [False] * 4)
        self.assertAlmostEqual(caps[0], 3.0, places=3)
        self.assertTrue(all(cap['right'] is None for _, cap, _ in collector.frames()))

    def test_a_reading_with_no_channels_is_a_row_of_nothing(self):
        collector = FrameCollector(BASELINES)
        collector.add_cap(T0, None, None)
        collector.add_piezo(T0, 1e6, 1e6)
        _, cap, _ = next(iter(collector.frames()))
        self.assertEqual(cap, {'left': None, 'right': None})

    def test_a_timestamp_that_is_not_a_number_adds_nothing(self):
        collector = FrameCollector(BASELINES)
        channels = scenarios.channels([12.0] * 8)
        for ts in ('soon', None, float('nan')):
            with self.assertRaises((TypeError, ValueError)):
                collector.add_cap(ts, channels, channels)
        collector.add_cap(T0, channels, channels)
        collector.add_piezo(T0, 1e6, 1e6)
        self.assertEqual(collector.nbytes(), 2 * 16)
        self.assertEqual(len(list(collector.frames())), 1)

    def test_records_out_of_order_come_back_sorted_once_per_second(self):
        collector = FrameCollector(BASELINES)
        for second in (3, 1, 2, 2, 0):
            collector.add_piezo(T0 + second, float(second), None)
        frames = list(collector.frames())
        self.assertEqual([t - T0 for t, _, _ in frames], [0, 1, 2, 3])
        self.assertIsNone(frames[0][2]['right'])

    def test_shuffled_and_repeated_records_replay_like_the_ordered_night(self):
        night = Night(seconds=3000, left=((400, 2500),), right=((200, 2800),))
        records = list(scenarios.raw_records(night))
        records += records[::5]
        random.Random(3).shuffle(records)
        collector = FrameCollector(BASELINES)
        for record in records:
            if record['type'] == 'capSense2':
                collector.add_cap(record['ts'], scenarios.channels(record['left']['values']), scenarios.channels(record['right']['values']))
            else:
                collector.add_piezo(
                    record['ts'],
                    piezo_range(np.frombuffer(record['left1'], dtype=np.int32)),
                    piezo_range(np.frombuffer(record['right1'], dtype=np.int32)),
                )
        times = [t for t, _, _ in collector.frames()]
        self.assertEqual(times, sorted(set(times)))
        self.assertEqual(replay(collector.frames(), PARAMS), replay(scenarios.frames(night), PARAMS))

    def test_coverage(self):
        self.assertAlmostEqual(collect(Night(seconds=600)).cap_coverage(), 1.0)
        collector = FrameCollector(BASELINES)
        for second in range(100):
            collector.add_piezo(T0 + second, 1e6, 1e6)
        self.assertEqual(collector.cap_coverage(), 0.0)
        self.assertEqual(FrameCollector(BASELINES).cap_coverage(), 0.0)
        self.assertEqual(list(FrameCollector(BASELINES).frames()), [])

    def test_a_record_costs_sixteen_bytes(self):
        collector = collect(Night(seconds=1000))
        # 1000 piezo records and 2000 capacitance records
        self.assertEqual(collector.nbytes(), 3000 * 16)

    def test_reading_back_a_25_hour_night_stays_within_the_memory_budget(self):
        collector = synthetic_night(25 * 3600)
        self.assertLess(read_back_peak(collector), TRANSIENT_BUDGET_BYTES)

    def test_records_added_while_a_frames_iterator_is_open_are_left_out(self):
        collector = collect(Night(seconds=50))
        frames = collector.frames()
        next(frames)
        collector.add_piezo(T0 + 500, 1e6, 1e6)
        collector.add_cap(T0 + 500, scenarios.channels([1.0] * 8), scenarios.channels([1.0] * 8))
        self.assertEqual(len(list(frames)), 49)
        self.assertEqual(len(list(collector.frames())), 51)


class OccupiedLevelTest(unittest.TestCase):
    def test_median_delta_inside_the_intervals(self):
        frames = scenarios.frames(scenarios.STAGGERED)
        intervals = replay(frames, PARAMS)
        level, seconds = occupied_level(frames, intervals['left'], 'left')
        self.assertEqual(level, 20.0)
        self.assertEqual(seconds, 13_859 - 1819)
        level, _ = occupied_level(frames, intervals['right'], 'right')
        self.assertEqual(level, 10.0)

    def test_repeated_and_stale_frames_do_not_change_the_level(self):
        ordered = scenarios.frames(scenarios.STAGGERED)
        intervals = replay(ordered, PARAMS)['left']
        expected = occupied_level(ordered, intervals, 'left')
        messy = with_repeats_and_stale_frames(ordered)
        self.assertEqual(occupied_level(messy, intervals, 'left'), expected)
        self.assertEqual(occupied_level(iter(messy), intervals, 'left'), expected)

    def test_nothing_occupied_has_no_level(self):
        self.assertEqual(occupied_level(scenarios.frames(Night(seconds=100)), [], 'left'), (None, 0))


if __name__ == '__main__':
    unittest.main()
