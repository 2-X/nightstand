"""Tests that a presence exit clears the smoothed vitals, not just the samples.

`self.hrv` and `self.breathing_rate` are the smoothed outputs of the
`hrv_rates` and `breath_rates` deques. They are only ever written from inside
`_calculate_vitals`, behind in-range gates, and the recompute is additionally
gated on `present_for >= 300` for HRV and `>= 30` for breathing. So a session
cannot produce its own HRV for its first five minutes.

They used to be initialised in `__init__` while `init_tracking()` cleared only
the deques, which meant a presence exit left them holding the departing
occupant's last reading. The next session then wrote that number as if it had
been measured, and because it sits inside the valid band, every consumer of
the vitals table averaged it in rather than excluding it. Against eleven days
of pulled pod data that was 16% of stored rows, 10% of them carrying a
previous session's value.

`combined_measurements` had the same shape of problem for a different reason:
`next()` inserts `combined_measurements[-1]`, so an entry left over from the
previous session is another path from one session's data into the next one's
rows.

Run locally (needs scipy/db stubbed, see below; the real dependencies only
exist on the pod):
    python3 -m unittest biometrics.__tests__.test_vitals_session_reset -v
"""
import unittest

import sys, os, types
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# heart.heartpy/heart.analysis pull in scipy at import time; db.py opens a
# real sqlite connection at import time. Neither is reachable from the local
# Mac and neither is touched by detect_presence / next(), so stub both out.
# Keep this stub identical in shape to the one in the sibling presence-gate
# test: whichever test module imports first wins, so they must agree.
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


QUIET = _signal(0)
DOMINANT = _signal(300_000)


class TestVitalsSessionReset(unittest.TestCase):
    def setUp(self):
        _PresenceCoordinator._latest = {'left': 0.0, 'right': 0.0}
        # insertion_frequency=1 so every next() call is an insertion tick.
        self.proc = BiometricProcessor(side='left', insertion_frequency=1, debug=False)
        self.proc._update_presence_api = lambda is_present: None

        self.insert_calls = []
        self._orig_insert_vitals = biometric_processor.insert_vitals
        biometric_processor.insert_vitals = lambda data: self.insert_calls.append(data)

    def tearDown(self):
        biometric_processor.insert_vitals = self._orig_insert_vitals

    def _enter_presence(self):
        for _ in range(self.proc._established_threshold + 5):
            self.proc.detect_presence(DOMINANT)
        self.assertTrue(self.proc.present)

    def _exit_presence_slowly(self):
        for _ in range(self.proc.no_presence_tolerance):
            self.proc.detect_presence(QUIET)
        self.assertFalse(self.proc.present)

    def _append_measurement(self, heart_rate=60.0, hrv=0, breathing_rate=0):
        self.proc.combined_measurements.append({
            'side': self.proc.side,
            'timestamp': 1_752_000_000,
            'heart_rate': heart_rate,
            'hrv': hrv,
            'breathing_rate': breathing_rate,
        })

    def test_smoothed_vitals_start_at_the_sentinel(self):
        self.assertEqual(self.proc.hrv, 0)
        self.assertEqual(self.proc.breathing_rate, 0)

    def test_presence_exit_clears_the_smoothed_vitals(self):
        self._enter_presence()
        # Stand in for a session that produced real readings.
        self.proc.hrv_rates.append(72.0)
        self.proc.breath_rates.append(14.0)
        self.proc.hrv = 72.0
        self.proc.breathing_rate = 14.0

        self._exit_presence_slowly()

        self.assertEqual(self.proc.hrv, 0)
        self.assertEqual(self.proc.breathing_rate, 0)
        self.assertEqual(len(self.proc.hrv_rates), 0)
        self.assertEqual(len(self.proc.breath_rates), 0)

    def test_next_session_does_not_open_on_the_previous_occupants_numbers(self):
        """The regression this fix exists for.

        HRV cannot recompute until present_for reaches 300, so whatever the
        attribute holds when a session starts is what its opening rows carry.
        After an exit that must be the sentinel and not the last occupant's
        reading.
        """
        self._enter_presence()
        self.proc.hrv = 72.0
        self.proc.breathing_rate = 14.0
        self._exit_presence_slowly()

        self._enter_presence()
        self.assertLess(self.proc.present_for, 300)
        self.assertEqual(self.proc.hrv, 0)
        self.assertEqual(self.proc.breathing_rate, 0)

    def test_presence_exit_clears_the_pending_measurement(self):
        """next() inserts combined_measurements[-1], so a leftover entry would
        write the previous session's row into the current one."""
        self._enter_presence()
        self._append_measurement(heart_rate=58.0)
        self._exit_presence_slowly()

        self.assertEqual(len(self.proc.combined_measurements), 0)

        # Re-enter and tick without producing a new measurement: there is
        # nothing left over to insert, so nothing is written.
        self._enter_presence()
        self.proc.heart_rates.append(61.0)
        self.proc.next()
        self.assertEqual(self.insert_calls, [])


if __name__ == '__main__':
    unittest.main()
