"""The live check that hands presence back when capacitance misses a bed in use."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from presence.detector import DetectorParams, SideParams
from presence.guard import UNEXPLAINED_SECONDS, UNEXPLAINED_WINDOW_SECONDS, UnexplainedUseGuard

SIDE = SideParams(enter_delta=300.0, exit_delta=150.0)
PARAMS = DetectorParams(left=SIDE, right=SIDE, piezo_floor={'left': 40_000.0, 'right': 70_000.0})
EMPTY = {'left': False, 'right': False}
ALIVE = {'left': 5_000_000.0, 'right': 3_000_000.0}
QUIET = {'left': 30_000.0, 'right': 30_000.0}


class UnexplainedUseGuardTest(unittest.TestCase):
    def run_steps(self, guard, steps, states, piezo):
        return [guard.step(states, piezo) for _ in range(steps)]

    def test_trips_after_ten_minutes_of_a_bed_in_use_with_nobody_in_it(self):
        guard = UnexplainedUseGuard(PARAMS)
        trips = self.run_steps(guard, UNEXPLAINED_SECONDS, EMPTY, ALIVE)
        self.assertFalse(any(trips[:-1]))
        self.assertTrue(trips[-1])

    def test_a_side_in_bed_explains_the_use(self):
        guard = UnexplainedUseGuard(PARAMS)
        self.assertFalse(any(self.run_steps(guard, 2000, {'left': True, 'right': False}, ALIVE)))

    def test_a_quiet_empty_bed_is_not_use(self):
        guard = UnexplainedUseGuard(PARAMS)
        self.assertFalse(any(self.run_steps(guard, 2000, EMPTY, QUIET)))

    def test_one_side_over_its_own_gate_is_use(self):
        guard = UnexplainedUseGuard(PARAMS)
        trips = self.run_steps(guard, UNEXPLAINED_SECONDS, EMPTY, {'left': 80_000.0, 'right': None})
        self.assertTrue(trips[-1])

    def test_old_seconds_are_forgotten(self):
        guard = UnexplainedUseGuard(PARAMS)
        self.run_steps(guard, UNEXPLAINED_SECONDS - 1, EMPTY, ALIVE)
        self.run_steps(guard, UNEXPLAINED_WINDOW_SECONDS, {'left': True, 'right': True}, ALIVE)
        self.assertFalse(guard.step(EMPTY, ALIVE))

    def test_a_right_side_in_bed_explains_the_use(self):
        guard = UnexplainedUseGuard(PARAMS)
        self.assertFalse(any(self.run_steps(guard, 2000, {'left': False, 'right': True}, ALIVE)))

    def test_each_side_is_held_to_its_own_gate(self):
        # Over the left gate (80k) but under the right one (140k), read on the right.
        guard = UnexplainedUseGuard(PARAMS)
        self.assertFalse(any(self.run_steps(guard, 2000, EMPTY, {'left': 30_000.0, 'right': 100_000.0})))

    def test_seconds_need_not_be_consecutive(self):
        guard = UnexplainedUseGuard(PARAMS)
        trips = []
        for _ in range(UNEXPLAINED_WINDOW_SECONDS // 3):
            trips += self.run_steps(guard, 2, EMPTY, ALIVE)
            trips += self.run_steps(guard, 1, EMPTY, QUIET)
        # The 600th unexplained second is the second to last.
        self.assertFalse(any(trips[:-2]))
        self.assertTrue(trips[-2])

    def test_the_count_falls_back_after_a_trip(self):
        guard = UnexplainedUseGuard(PARAMS)
        self.assertTrue(self.run_steps(guard, UNEXPLAINED_SECONDS, EMPTY, ALIVE)[-1])
        explained = UNEXPLAINED_WINDOW_SECONDS - UNEXPLAINED_SECONDS
        self.assertTrue(all(self.run_steps(guard, explained, {'left': True, 'right': False}, ALIVE)))
        self.assertFalse(guard.step({'left': True, 'right': False}, ALIVE))

    def test_missing_or_nan_piezo_is_not_use(self):
        guard = UnexplainedUseGuard(PARAMS)
        self.assertFalse(any(self.run_steps(guard, 2000, EMPTY, {'left': float('nan'), 'right': None})))


if __name__ == '__main__':
    unittest.main()
