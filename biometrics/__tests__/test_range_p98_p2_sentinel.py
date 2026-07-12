"""Tests for sane-max sentinel rejection in _range_p98_p2.

Root cause: `_range_p98_p2` computes a percentile-based signal range but had
no sanity-max rejection, so a raw garbage sample flows straight into the
percentile calc. Two real cases seen on the live pod:

  - one case: a raw value of 2_148_008_185 (~2^31, an int32-overflow-style
    garbage read) got included in a _range_p98_p2 window and produced an
    absurd range that helped latch a false "present" state for 5+ hours on
    an empty bed.
  - a second case: both the left AND right piezo channels independently
    computed a range of exactly 16_777_215 (2^24 - 1) at the same one-second
    tick.

The same log window also confirms genuinely occupied sides regularly produce
large-but-real ranges up to ~16-17M (e.g. R=14654897, R=6479814 during a
confirmed active dual-occupancy session), so the fix must reject only the
~2^31-scale garbage, not legitimate high readings.

The mask is symmetric: raw piezo samples are signed int32, and overflow or
wraparound produces large-magnitude NEGATIVE garbage just as readily as
positive. The real 2_148_008_185 sentinel, reinterpreted as signed 32-bit
wraparound, lands at -2_146_959_111, so a mask that only bounds from above
would leave that failure mode wide open.

Run locally (needs scipy/db stubbed -- see the stubbing below; real
dependencies are only exercised on the pod):
    python3 -m unittest biometrics.__tests__.test_range_p98_p2_sentinel -v
"""
import unittest

import sys, os, types
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# heart.heartpy/heart.analysis pull in scipy at import time; db.py opens a
# real sqlite connection at import time. Neither is reachable from the local
# Mac and neither is touched by _range_p98_p2, so stub both out.
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
from biometric_processor import BiometricProcessor

# The two real values observed on the pod.
REAL_GARBAGE_SENTINEL = 2_148_008_185   # ~2^31 overflow-style garbage
REAL_LEGITIMATE_MAX = 16_777_215        # 2^24 - 1, within legitimate range

# An extra synthetic garbage magnitude, clearly beyond any legitimate reading,
# to confirm rejection isn't a one-off fluke tied to the single real sample.
SYNTHETIC_GARBAGE = 2_000_000_000


class TestRangeP98P2SentinelRejection(unittest.TestCase):
    def test_normal_signal_produces_unchanged_range(self):
        # A normal, garbage-free signal must produce exactly the same range
        # as a plain p98-p2 calc -- the sane-max rejection must not touch
        # legitimate data.
        arr = np.arange(1000, dtype=np.int32) + 500  # values roughly 500..1499
        expected = float(
            np.percentile(arr.astype(np.int64), 98) - np.percentile(arr.astype(np.int64), 2)
        )
        self.assertAlmostEqual(BiometricProcessor._range_p98_p2(arr), expected, places=6)

    def test_garbage_sentinel_sample_does_not_blow_up_range(self):
        # A modest window (n=50) where a normal signal varies only slightly
        # (0..49) but ONE sample is the real garbage sentinel. With a window
        # this size, a single top-of-range outlier is well within the
        # p98 percentile's rank (unlike a 500+-sample window, where a lone
        # outlier falls past the 98th percentile and gets ignored for free)
        # so un-masked it drags p98 up to ~43M -- the failure mode from the
        # first case. Masked, the range should stay close to the
        # real signal's own spread (~48).
        n = 50
        arr = np.arange(n, dtype=np.int64)
        arr[-1] = REAL_GARBAGE_SENTINEL
        result = BiometricProcessor._range_p98_p2(arr)
        self.assertLess(result, 1000.0)

    def test_synthetic_extreme_garbage_sample_is_rejected(self):
        n = 50
        arr = np.arange(n, dtype=np.int64)
        arr[-1] = SYNTHETIC_GARBAGE
        result = BiometricProcessor._range_p98_p2(arr)
        self.assertLess(result, 1000.0)

    def test_negative_garbage_sentinel_sample_is_rejected(self):
        # Raw piezo samples are signed int32 (see load_raw_files.py's
        # np.frombuffer(..., dtype=np.int32)), and int32 overflow/wraparound
        # produces large-magnitude NEGATIVE garbage just as readily as
        # positive -- the real 2_148_008_185 sentinel, reinterpreted as
        # signed 32-bit wraparound, lands at -2_146_959_111. A mask that only
        # bounds from above lets this sail through untouched and reproduces
        # the exact bug this fix exists to close.
        n = 50
        arr = np.arange(n, dtype=np.int64)
        arr[-1] = -REAL_GARBAGE_SENTINEL
        result = BiometricProcessor._range_p98_p2(arr)
        self.assertLess(result, 1000.0)

    def test_negative_synthetic_garbage_sample_is_rejected(self):
        n = 50
        arr = np.arange(n, dtype=np.int64)
        arr[-1] = -SYNTHETIC_GARBAGE
        result = BiometricProcessor._range_p98_p2(arr)
        self.assertLess(result, 1000.0)

    def test_ceiling_boundary_is_inclusive(self):
        # A sample at exactly _SANE_MAX_SIGNAL must be KEPT (locks in the
        # intended inclusive `<=` semantics); one unit past it must be
        # REJECTED. Baseline is a flat zero signal so any kept extreme
        # sample dominates p98 and any rejected one leaves the range at 0.
        n = 50
        ceiling = BiometricProcessor._SANE_MAX_SIGNAL

        kept = np.zeros(n, dtype=np.int64)
        kept[-1] = ceiling
        self.assertGreater(BiometricProcessor._range_p98_p2(kept), 300_000.0)

        rejected = np.zeros(n, dtype=np.int64)
        rejected[-1] = ceiling + 1
        self.assertEqual(BiometricProcessor._range_p98_p2(rejected), 0.0)

    def test_legitimate_16m_value_is_not_rejected(self):
        # Half the window at the real legitimate max. This is
        # WITHIN the sane ceiling and must still contribute to the range --
        # the critical guardrail against over-rejecting real occupied-bed
        # signal.
        n = 1000
        arr = np.zeros(n, dtype=np.int64)
        arr[n // 2:] = REAL_LEGITIMATE_MAX
        result = BiometricProcessor._range_p98_p2(arr)
        self.assertAlmostEqual(result, float(REAL_LEGITIMATE_MAX), delta=1.0)

    def test_all_samples_above_ceiling_returns_zero_gracefully(self):
        # Degenerate case: every sample in the window is garbage. There is
        # no real signal left to measure, so this must return 0.0 rather
        # than crash or fall back to computing percentiles over garbage.
        arr = np.full(500, REAL_GARBAGE_SENTINEL, dtype=np.int64)
        result = BiometricProcessor._range_p98_p2(arr)
        self.assertEqual(result, 0.0)

    def test_none_and_empty_signal_still_handled(self):
        self.assertEqual(BiometricProcessor._range_p98_p2(None), 0.0)
        self.assertEqual(BiometricProcessor._range_p98_p2(np.array([], dtype=np.int64)), 0.0)


if __name__ == '__main__':
    unittest.main()
