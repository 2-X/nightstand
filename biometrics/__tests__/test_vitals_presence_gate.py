"""Tests for the vitals-insertion presence gate (BUG-03).

Root cause: BiometricProcessor.next() inserted heart rate / HRV / breathing
into the DB purely on a tick counter (`iteration_count % insertion_frequency`)
with zero regard for whether this side of the bed is actually occupied right
now. On the 2026-07-09 incident night, LEFT kept inserting vitals for ~20
minutes after the left occupant got up: first converging on the RIGHT side's
real heart rate (mechanical crosstalk through the shared mattress frame), then
-- once both occupants had left -- logging noise (~57-60 bpm) on a genuinely
empty bed.

`self.present` (maintained by detect_presence()) is the existing per-side
presence signal; this fix simply refuses to call insert_vitals() when
self.present is False for that side.

Known residual limitation (not fixed here, see NOTE in biometric_processor.py
next()): this gate is only as good as presence detection itself. It fully
closes the "empty bed still logging vitals" hole. It does NOT fix the case
where detect_presence() itself is fooled by cross-mattress transmission into
holding self.present True on the wrong side -- that is a separate presence-
detection (crosstalk) problem tracked elsewhere.

Run locally (needs scipy/db stubbed -- see the stubbing below; real
dependencies are only exercised on the pod, see CLAUDE.md):
    python3 -m unittest biometrics.__tests__.test_vitals_presence_gate -v
"""
import unittest

import sys, os, types
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# heart.heartpy/heart.analysis pull in scipy at import time; db.py opens a
# real sqlite connection at import time. Neither is reachable from the local
# Mac (see CLAUDE.md's Python-tests note) and neither is touched by
# detect_presence / next(), so stub both out.
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
import biometric_processor
from biometric_processor import BiometricProcessor, _PresenceCoordinator


def _signal(value, n=1000):
    """A signal array whose p98-p2 range is ~= value (see _range_p98_p2)."""
    arr = np.zeros(n, dtype=np.int64)
    arr[n // 2:] = value
    return arr


QUIET = _signal(0)                                    # range 0, well below noise
DOMINANT = _signal(300_000)                            # range 300k, clearly above noise


class TestVitalsPresenceGate(unittest.TestCase):
    def setUp(self):
        _PresenceCoordinator._latest = {'left': 0.0, 'right': 0.0}
        # insertion_frequency=1 so every next() call is an insertion tick --
        # keeps test setup focused on the presence gate, not the tick math.
        self.proc = BiometricProcessor(side='left', insertion_frequency=1, debug=False)
        self.proc._update_presence_api = lambda is_present: None

        self.insert_calls = []
        self._orig_insert_vitals = biometric_processor.insert_vitals
        biometric_processor.insert_vitals = lambda data: self.insert_calls.append(data)

    def tearDown(self):
        biometric_processor.insert_vitals = self._orig_insert_vitals

    def _prime_measurement(self, heart_rate=60.0):
        """Populate the state next() needs to consider an insertion."""
        self.proc.heart_rates.clear()
        self.proc.heart_rates.append(heart_rate)
        self.proc.combined_measurements.append({
            'side': self.proc.side,
            'timestamp': 1_752_000_000,
            'heart_rate': heart_rate,
            'hrv': 0,
            'breathing_rate': 0,
        })

    def test_insert_skipped_when_not_present(self):
        self.assertFalse(self.proc.present)  # default state
        self._prime_measurement()
        self.proc.next()
        self.assertEqual(self.insert_calls, [])

    def test_insert_happens_when_present(self):
        self.proc.present = True
        self._prime_measurement(heart_rate=62.0)
        self.proc.next()
        self.assertEqual(len(self.insert_calls), 1)
        self.assertEqual(self.insert_calls[0]['heart_rate'], 62.0)

    def test_no_lag_gates_the_frame_presence_exits_on(self):
        """
        End-to-end version of the incident: establish real presence via
        detect_presence(), then feed quiet frames until the slow (180s) exit
        fires and self.present flips to False. detect_presence() runs before
        next() within the same processing tick in stream_processor.py's
        process_piezo_record(), so by the time next() would insert on that
        same tick, self.present must already reflect the exit -- no one-frame
        lag should let the just-vacated frame slip through.
        """
        for _ in range(self.proc._established_threshold + 5):
            self.proc.detect_presence(DOMINANT)
        self.assertTrue(self.proc.present)

        for _ in range(self.proc.no_presence_tolerance - 1):
            self.proc.detect_presence(QUIET)
        self.assertTrue(self.proc.present)  # not yet -- one tick short

        # This is the exact tick the slow-exit fires on.
        self.proc.detect_presence(QUIET)
        self.assertFalse(self.proc.present)

        # Simulate the vitals insertion that would run on this same tick.
        self._prime_measurement(heart_rate=58.0)
        self.proc.next()
        self.assertEqual(self.insert_calls, [])

    def test_insert_resumes_after_reentry(self):
        """Gate is dynamic, not latched: once presence returns, inserts flow
        again."""
        self._prime_measurement()
        self.proc.next()
        self.assertEqual(self.insert_calls, [])

        self.proc.present = True
        self._prime_measurement(heart_rate=65.0)
        self.proc.next()
        self.assertEqual(len(self.insert_calls), 1)
        self.assertEqual(self.insert_calls[0]['heart_rate'], 65.0)


if __name__ == '__main__':
    unittest.main()
