from __future__ import annotations

from fractions import Fraction

import numpy as np
from scipy import signal

from vitals2._acf import acf_period

CARDIAC_FS = 100.0
WINDOW_SECONDS = 10
HOP_SECONDS = 5
# Filter context the caller adds on each side of the analysed window.
EDGE_SECONDS = 2
SEARCH_BPM = (30, 160)

_BAND = signal.butter(4, [1.0, 10.0], btype='bandpass', fs=CARDIAC_FS, output='sos')
_ENVELOPE_LOWPASS = signal.butter(2, 4.0, btype='lowpass', fs=CARDIAC_FS, output='sos')


def resample(values: np.ndarray, fs: float, target_fs: float) -> np.ndarray:
    ratio = Fraction(int(round(target_fs)), int(round(fs))).limit_denominator(1000)
    return signal.resample_poly(values - np.median(values), ratio.numerator, ratio.denominator)


def cardiac_band(window: np.ndarray, fs: float) -> np.ndarray:
    """The 1 to 10 Hz band of a cleaned window, at CARDIAC_FS."""
    return signal.sosfiltfilt(_BAND, resample(np.asarray(window, dtype=np.float64), fs, CARDIAC_FS))


def central(values: np.ndarray, fs: float, seconds: float) -> np.ndarray:
    keep = int(round(seconds * fs))
    if values.size <= keep:
        return values
    start = (values.size - keep) // 2
    return values[start:start + keep]


def hr_from_cardiac(cardiac: np.ndarray, previous_bpm: float | None = None) -> tuple[float | None, float]:
    envelope = signal.sosfiltfilt(_ENVELOPE_LOWPASS, np.abs(signal.hilbert(cardiac)))
    envelope = central(envelope, CARDIAC_FS, WINDOW_SECONDS)
    previous = 60.0 / previous_bpm if previous_bpm else None
    period, quality = acf_period(envelope, CARDIAC_FS, 60.0 / SEARCH_BPM[1], 60.0 / SEARCH_BPM[0], previous)
    if period is None:
        return None, 0.0
    return 60.0 / period, quality


def estimate_hr(window: np.ndarray, fs: float, previous_bpm: float | None = None) -> tuple[float | None, float]:
    """Heart rate (bpm) and quality (0..1) from the central WINDOW_SECONDS of a cleaned window.

    Band-passes 1 to 10 Hz, takes the Hilbert envelope and reads the beat
    period from its autocorrelation. Pass EDGE_SECONDS of extra signal on each
    side so filter edges fall outside the analysed part. The caller applies
    the quality and range gates.
    """
    return hr_from_cardiac(cardiac_band(window, fs), previous_bpm)
