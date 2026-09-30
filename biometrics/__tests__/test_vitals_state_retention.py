"""With the capacitance detector in charge, a short absence no longer wipes a
side's vitals state; a long one, or someone else taking the side, still does.

Under the piezo detector every exit cleared heart rate bounds, breathing and
HRV, so each presence blip cost five minutes of HRV. Those exits were mostly
false, but real short absences (a trip to the bathroom) should not cost it
either. Clearing on a long absence keeps the previous occupant's numbers
from reaching the next one's rows.
"""
import logging
import os
import sys
import types
import unittest
import unittest.mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

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

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'stream'))
import biometric_processor
from biometric_processor import VITALS_RESET_ABSENCE_SECONDS, BiometricProcessor


class ApplyPresenceTest(unittest.TestCase):
    def setUp(self):
        self.posts = []
        patcher = unittest.mock.patch.object(
            BiometricProcessor, '_update_presence_api',
            lambda processor, present: self.posts.append(present),
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.processor = BiometricProcessor(side='right', insertion_frequency=1)
        self.epoch = 1_790_568_000

    def _run(self, present: bool, seconds: int, reset_state: bool = False):
        for _ in range(seconds):
            self.epoch += 1
            self.processor.apply_presence(present, self.epoch, reset_state=reset_state)

    def _measure(self):
        """State a session builds up: heart rate history, HRV and breathing."""
        self.processor.heart_rates.extend([62.0] * 5)
        self.processor.hrv = 48.0
        self.processor.breathing_rate = 15.0
        self.processor.lower_bound = 50.0
        self.processor.upper_bound = 75.0
        self.processor.hr_moving_avg = 62.0

    def test_entry_and_exit_post_once_each(self):
        self._run(True, 30)
        self._run(False, 30)
        self.assertEqual(self.posts, [True, False])

    def test_present_for_counts_unbroken_presence(self):
        self._run(True, 30)
        self.assertEqual(self.processor.present_for, 30)
        self._run(False, 10)
        self.assertEqual(self.processor.present_for, 0)
        self._run(True, 5)
        self.assertEqual(self.processor.present_for, 5)

    def test_a_short_absence_keeps_the_vitals_state(self):
        self._run(True, 400)
        self._measure()
        self._run(False, 180)
        self._run(True, 1)
        self.assertEqual(self.processor.hrv, 48.0)
        self.assertEqual(self.processor.breathing_rate, 15.0)
        self.assertEqual(list(self.processor.heart_rates), [62.0] * 5)
        self.assertEqual((self.processor.lower_bound, self.processor.upper_bound), (50.0, 75.0))

    def test_an_absence_one_second_short_of_the_limit_keeps_it(self):
        self._run(True, 400)
        self._measure()
        self._run(False, VITALS_RESET_ABSENCE_SECONDS - 1)
        self.assertEqual(self.processor.hrv, 48.0)
        self.assertEqual(len(self.processor.heart_rates), 5)
        self.assertEqual(self.processor.upper_bound, 75.0)

    def test_a_long_absence_clears_it(self):
        self._run(True, 400)
        self._measure()
        self.assertEqual(self.processor.upper_bound, 75.0)
        self._run(False, VITALS_RESET_ABSENCE_SECONDS)
        self.assertEqual(self.processor.hrv, 0)
        self.assertEqual(self.processor.breathing_rate, 0)
        self.assertEqual(len(self.processor.heart_rates), 0)
        self.assertIsNone(self.processor.upper_bound)

    def test_someone_else_taking_the_side_clears_it(self):
        self._run(True, 400)
        self._measure()
        self._run(False, 60)
        self._run(True, 1, reset_state=True)
        self.assertEqual(self.processor.hrv, 0)
        self.assertEqual(len(self.processor.heart_rates), 0)

    def test_heartbeat_repeats_the_state_every_minute(self):
        self._run(True, 150)
        self.assertEqual(self.posts, [True, True, True])

    def test_the_exit_time_is_kept(self):
        self._run(True, 30)
        self._run(False, 1)
        self.assertEqual(self.processor.last_exit_at, self.epoch)

    def test_nothing_is_inserted_while_absent(self):
        inserted = []
        with unittest.mock.patch.object(biometric_processor, 'insert_vitals', side_effect=inserted.append):
            self._run(True, 30)
            self.processor.combined_measurements.append(
                {'side': 'right', 'timestamp': self.epoch, 'heart_rate': 60.0, 'hrv': 0, 'breathing_rate': 0})
            self.processor.heart_rates.append(60.0)
            self.processor.next()
            self._run(False, 30)
            self.processor.next()
        self.assertEqual(len(inserted), 1)

    def test_ending_the_session_for_a_detector_change_clears_everything(self):
        self._run(True, 400)
        self._measure()
        self.processor.end_presence_session()
        self.assertFalse(self.processor.present)
        self.assertEqual(self.posts[-1], False)
        self.assertEqual(self.processor.hrv, 0)
        self.assertIsNone(self.processor.last_exit_at)
        self.assertEqual((self.processor.present_for, self.processor.absent_for), (0, 0))

    def test_ending_the_session_leaves_the_piezo_detector_clean(self):
        for present in (False, True):
            with self.subTest(present=present):
                if present:
                    self._run(True, 30)
                self.processor._recent_ranges.extend([900.0] * 20)
                self.processor._reentry_streak = 2
                self.processor._ambiguous_streak = 3
                self.processor.end_presence_session()
                self.assertEqual(len(self.processor._recent_ranges), 0)
                self.assertEqual(self.processor._reentry_streak, 0)
                self.assertEqual(self.processor._ambiguous_streak, 0)


if __name__ == '__main__':
    unittest.main()
