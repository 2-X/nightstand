"""Behavioral tests for the BUG-04 is_ambiguous_both exit-freeze fix.

Root cause (2026-07-11 morning): once both sides read above NOISE_THRESHOLD but
neither is 1.3x-dominant, the coordinator returns is_ambiguous_both. That branch
used to FREEZE the exit clock (never advance not_present_for), so an empty side
receiving cross-mattress crosstalk from a still-present partner latched
"present" for hours -- the 180s slow-exit never even started counting. Two
crosstalk mechanisms kept it latched: the freeze itself, and clearly-dominant
crosstalk bursts (an empty side's range momentarily exceeding the occupied
side's) hard-resetting the exit clock.

The fix: during ambiguous_both, consult a rolling low-percentile
"between-burst floor" of THIS
side's own range against its learned occupied floor. Advance the exit clock only
when the floor looks empty; hold (don't reset) on crosstalk bursts while the
floor looks empty; and leak the clock via a bounded backstop so nothing freezes
forever. Biased hard toward staying present: a genuine quiet sleeper (high
floor) sees exactly the pre-fix freeze behavior and never exits early.

This exercises the full BiometricProcessor, so it needs numpy and is
POD-ONLY: it cannot run in an environment without numpy installed. The
pure decision logic is covered locally-runnable in test_presence_floor.py.

Run on the pod:
    /home/dac/venv/bin/python -m unittest __tests__.test_presence_ambiguous_floor -v
"""
import unittest

import sys
import os
import types
from collections import deque

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# heart.heartpy/heart.analysis pull in scipy at import time; db.py opens a real
# sqlite connection at import time. Neither is touched by detect_presence, so
# stub both (mirrors test_presence_reentry.py).
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

_db = types.ModuleType('db')
_db.insert_vitals = lambda *a, **k: None
sys.modules.setdefault('db', _db)

import logging
import get_logger as _gl
_gl._get_file_handler = lambda data_folder_path, name: logging.NullHandler()
from get_logger import get_logger, LOGGER_NAMES

for _name in LOGGER_NAMES:
    get_logger(_name)

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'stream'))
import numpy as np
from biometric_processor import BiometricProcessor, _PresenceCoordinator

# Ranges (see _range_p98_p2). All well above NOISE_THRESHOLD=150k unless noted.
OCCUPIED = 3_000_000     # a genuinely occupied side's between-burst floor
CROSSTALK_FLOOR = 600_000  # an empty side's between-burst floor under crosstalk
CROSSTALK_BURST = 2_000_000  # an empty side's range during a partner movement burst
QUIET = 0                # below noise


def _signal(value, n=1000):
    """A signal array whose p98-p2 range is ~= value (see _range_p98_p2)."""
    arr = np.zeros(n, dtype=np.int64)
    arr[n // 2:] = value
    return arr


class _Bed:
    """Drives both sides tick-by-tick through the shared coordinator."""

    def __init__(self):
        _PresenceCoordinator._latest = {'left': 0.0, 'right': 0.0}
        self.left = BiometricProcessor(side='left')
        self.right = BiometricProcessor(side='right')
        self.calls = []
        self.left._update_presence_api = lambda p: self.calls.append(('left', p))
        self.right._update_presence_api = lambda p: self.calls.append(('right', p))
        # Shrink the floor window so tests run in tens of frames, not 300. The
        # deque maxlen is fixed at construction, so re-create it here.
        for proc in (self.left, self.right):
            proc._FLOOR_MIN_WINDOW = 10
            proc._recent_ranges = deque([], maxlen=10)

    def tick(self, left_val, right_val):
        self.left.detect_presence(_signal(left_val))
        self.right.detect_presence(_signal(right_val))


class TestAmbiguousFloorExit(unittest.TestCase):
    def _establish_left(self, bed, seconds=70):
        # Left genuinely occupied (clear dominance), right empty, long enough to
        # enter presence, pass _established_threshold (60s) so the slow path
        # applies, fill the 10-sample floor window, and seed occupied_floor_est.
        for _ in range(seconds):
            bed.tick(OCCUPIED, QUIET)
        self.assertTrue(bed.left.present)
        self.assertGreaterEqual(bed.left._presence_session_seconds,
                                bed.left._established_threshold)
        self.assertIsNotNone(bed.left._occupied_floor_est)
        self.assertGreater(bed.left._occupied_floor_est, 2_000_000)

    def test_empty_floor_breaks_the_freeze_and_exits(self):
        """The fix: ambiguous_both + collapsed floor now reaches the slow exit."""
        bed = _Bed()
        self._establish_left(bed)
        bed.calls.clear()

        # Tim is up; left now sees crosstalk. Keep left/right comparable
        # (ratio < 1.3) so the coordinator returns ambiguous_both for left,
        # with left's own floor collapsed toward the crosstalk level.
        exited_at = None
        for i in range(1, 260):
            bed.tick(CROSSTALK_FLOOR, 700_000)
            if not bed.left.present:
                exited_at = i
                break
        self.assertIsNotNone(exited_at, 'left never exited the crosstalk latch')
        # Floor needs a couple of frames to drop, then 180s slow-exit: lands in
        # a tight band just past the 180 grace (well under an hour, unlike the
        # old indefinite freeze).
        self.assertGreaterEqual(exited_at, bed.left.no_presence_tolerance)
        self.assertLessEqual(exited_at, bed.left.no_presence_tolerance + 15)
        self.assertIn(('left', False), bed.calls)

    def test_genuine_quiet_sleeper_never_exits(self):
        """Safety property: high floor => freeze preserved, no false exit.

        Two people genuinely present, symmetric amplitudes (ambiguous_both every
        tick), left's floor high. This is exactly the case the approved bias
        protects. Must behave like the pre-fix freeze: stay present, exit clock
        frozen at 0, for far longer than any real exit latency.
        """
        bed = _Bed()
        self._establish_left(bed)

        for _ in range(400):
            bed.tick(OCCUPIED, 2_600_000)  # both high, ratio ~1.15 => ambiguous
        self.assertTrue(bed.left.present)
        self.assertEqual(bed.left.not_present_for, 0)
        self.assertFalse(bed.left._occupied_floor_est is None)

    def test_crosstalk_dominant_burst_does_not_reset_clock(self):
        """A clearly-dominant crosstalk burst holds (not resets) the exit clock
        while the floor still looks empty -- the second latch mechanism."""
        bed = _Bed()
        self._establish_left(bed)

        # Accumulate exit progress via empty-floor ambiguous frames.
        for _ in range(40):
            bed.tick(CROSSTALK_FLOOR, 700_000)
        progressed = bed.left.not_present_for
        self.assertGreater(progressed, 0)
        self.assertTrue(bed.left.present)

        # A crosstalk movement burst makes left momentarily clearly dominant.
        # Floor still looks empty => the clock must be HELD, not reset to 0.
        bed.tick(CROSSTALK_BURST, 700_000)
        self.assertGreaterEqual(bed.left.not_present_for, progressed)
        self.assertEqual(bed.left._reentry_streak, 0)
        self.assertTrue(bed.left.present)

    def test_backstop_leaks_when_no_reference(self):
        """2d backstop: even with no floor reference and a never-empty floor, a
        long unbroken ambiguous run cannot freeze the exit clock forever."""
        bed = _Bed()
        # Force the "no learned reference" case and an established session.
        bed.left.present = True
        bed.left._presence_session_seconds = 200
        bed.left._occupied_floor_est = None
        bed.left._AMBIGUOUS_FREEZE_CAP = 10
        bed.left._AMBIGUOUS_LEAK_DIVISOR = 2
        _PresenceCoordinator._latest = {'left': 0.0, 'right': 0.0}
        bed.calls.clear()

        exited = False
        for _ in range(600):
            # Comparable ranges => ambiguous_both; est is None => floor never
            # "empty", so only the backstop leak can drive the exit.
            bed.tick(1_000_000, 1_100_000)
            if not bed.left.present:
                exited = True
                break
        self.assertTrue(exited, 'backstop failed to leak the exit clock')
        self.assertIn(('left', False), bed.calls)


if __name__ == '__main__':
    unittest.main()
