"""Tests for the live presence exit-clock spike tolerance (BUG-01).

Root cause: a piezo permanently loaded by pillows/a topper idles close to
_PresenceCoordinator.NOISE_THRESHOLD and spikes above it every few minutes
even with nobody in bed. The exit clock (not_present_for) used to hard-reset
to 0 on any single clearly-dominant frame, so a spiky-but-empty side never
reached the 180s slow-exit and stayed latched "present" for hours -- which in
turn blocked the calibration job's occupancy guard from ever running.

Run locally (needs scipy/db stubbed -- see the stubbing below; real
dependencies are only exercised on the pod, see CLAUDE.md):
    python3 -m unittest biometrics.__tests__.test_presence_reentry -v
"""
import unittest

import sys, os, types
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# heart.heartpy/heart.analysis pull in scipy at import time; db.py opens a
# real sqlite connection at import time. Neither is reachable from the local
# Mac (see CLAUDE.md's Python-tests note) and neither is touched by
# detect_presence / _PresenceCoordinator, so stub both out.
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


def _signal(value, n=1000):
    """A signal array whose p98-p2 range is ~= value (see _range_p98_p2)."""
    arr = np.zeros(n, dtype=np.int64)
    arr[n // 2:] = value
    return arr


QUIET = _signal(0)                                    # range 0, well below noise
DOMINANT = _signal(300_000)                            # range 300k, clearly above noise


class TestPresenceReentry(unittest.TestCase):
    def setUp(self):
        _PresenceCoordinator._latest = {'left': 0.0, 'right': 0.0}
        self.left = BiometricProcessor(side='left')
        self.right = BiometricProcessor(side='right')
        self.calls = []
        self.left._update_presence_api = lambda is_present: self.calls.append(('left', is_present))
        self.right._update_presence_api = lambda is_present: self.calls.append(('right', is_present))

    def _establish_presence(self):
        # 5 consecutive clearly-dominant seconds to enter presence, then run
        # the session past _established_threshold (60s) so the slow 180s exit
        # path applies instead of the short-session 30s fast-exit grace --
        # that fast-exit is a separate, correct mechanism this test isn't
        # about.
        for _ in range(self.left._established_threshold + 5):
            self.left.detect_presence(DOMINANT)
            self.right.detect_presence(QUIET)
        self.assertTrue(self.left.present)
        self.assertGreaterEqual(self.left._presence_session_seconds, self.left._established_threshold)

    def test_isolated_spike_does_not_reset_exit_clock(self):
        self._establish_presence()
        self.calls.clear()

        # Genuinely empty now: quiet for 100s, accumulating exit progress.
        for _ in range(100):
            self.left.detect_presence(QUIET)
            self.right.detect_presence(QUIET)
        self.assertEqual(self.left.not_present_for, 100)

        # A single noise spike on the left (matches the pillow-loaded-piezo
        # failure mode) must not cancel the 100s of accumulated exit progress.
        self.left.detect_presence(DOMINANT)
        self.right.detect_presence(QUIET)
        self.assertEqual(self.left.not_present_for, 100)
        self.assertEqual(self.left._reentry_streak, 1)
        self.assertTrue(self.left.present)

        # Back to quiet: the held frame cost nothing but its own tick: 80 more
        # quiet frames reaches the 180s slow-exit threshold right on schedule.
        for _ in range(79):
            self.left.detect_presence(QUIET)
            self.right.detect_presence(QUIET)
        self.assertTrue(self.left.present)

        self.left.detect_presence(QUIET)
        self.right.detect_presence(QUIET)
        self.assertFalse(self.left.present)
        self.assertIn(('left', False), self.calls)

    def test_sustained_return_clears_the_exit_clock(self):
        self._establish_presence()

        for _ in range(50):
            self.left.detect_presence(QUIET)
            self.right.detect_presence(QUIET)
        self.assertEqual(self.left.not_present_for, 50)

        # A real return: 3 consecutive dominant frames (the confirm streak).
        for _ in range(3):
            self.left.detect_presence(DOMINANT)
            self.right.detect_presence(QUIET)

        self.assertEqual(self.left.not_present_for, 0)
        self.assertEqual(self.left._reentry_streak, 0)
        self.assertTrue(self.left.present)

    def test_genuinely_empty_bed_still_exits_on_schedule(self):
        self._establish_presence()
        self.calls.clear()

        for _ in range(180):
            self.left.detect_presence(QUIET)
            self.right.detect_presence(QUIET)

        self.assertFalse(self.left.present)
        self.assertIn(('left', False), self.calls)


if __name__ == '__main__':
    unittest.main()
