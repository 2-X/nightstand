from __future__ import annotations

import numpy as np

from vitals2.hr import ENVELOPE_FS, HrWindow

# Envelope correlation within MAX_LAG_SECONDS of zero lag from which both
# sides may be hearing one heart.
SHARED_CORRELATION = 0.5
MAX_LAG_SECONDS = 0.1
# Tracked rates this close (log ratio) count as one rate.
SHARED_RATE = 0.02


def _zero_lag_correlation(left: np.ndarray, right: np.ndarray) -> float:
    left = left - left.mean()
    right = right - right.mean()
    scale = float(np.sqrt(np.dot(left, left) * np.dot(right, right)))
    if scale == 0:
        return 0.0
    lag = int(round(MAX_LAG_SECONDS * ENVELOPE_FS))
    best = 0.0
    for shift in range(-lag, lag + 1):
        if shift >= 0:
            value = np.dot(left[shift:], right[:right.size - shift])
        else:
            value = np.dot(left[:shift], right[-shift:])
        best = max(best, float(value) / scale)
    return best


def attribute(left: HrWindow, right: HrWindow) -> tuple[bool, bool]:
    """Which sides may keep this window's heart rate (keep left, keep right).

    When both sides track the same rate and their cardiac envelopes rise and
    fall together near zero lag, one heart is showing on both sensors, and
    only the side where its envelope is stronger keeps the window.
    """
    if left.envelope is None or right.envelope is None or left.envelope.size != right.envelope.size:
        return True, True
    if not (np.isfinite(left.track) and np.isfinite(right.track)):
        return True, True
    if abs(np.log(left.track / right.track)) > SHARED_RATE:
        return True, True
    if _zero_lag_correlation(left.envelope, right.envelope) < SHARED_CORRELATION:
        return True, True
    left_strength, right_strength = float(np.std(left.envelope)), float(np.std(right.envelope))
    return left_strength >= right_strength, right_strength > left_strength
