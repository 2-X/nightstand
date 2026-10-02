from __future__ import annotations

import numpy as np
from scipy import signal

from vitals2._acf import acf_period
from vitals2.hr import central, resample

RESP_FS = 10.0
WINDOW_SECONDS = 60
HOP_SECONDS = 10
# Filter context the caller adds on each side of the analysed window.
EDGE_SECONDS = 15
# The autocorrelation and spectral peaks must agree this closely (per minute).
AGREEMENT_PER_MINUTE = 1.0
# Searched a little beyond the gate so rates at its edges still form a peak.
SEARCH_PER_MINUTE = (5, 36)

_BAND = signal.butter(2, [0.1, 0.7], btype='bandpass', fs=RESP_FS, output='sos')


def estimate_resp(window: np.ndarray, fs: float) -> tuple[float | None, float]:
    """Breathing rate (per minute) and quality (0..1) from the central WINDOW_SECONDS.

    Decimates to 10 Hz, band-passes 0.1 to 0.7 Hz with a zero-phase filter and
    reads the period from the autocorrelation. The rate is reported only when
    the Welch spectral peak agrees within AGREEMENT_PER_MINUTE. The caller
    applies the quality gate.
    """
    band = signal.sosfiltfilt(_BAND, resample(np.asarray(window, dtype=np.float64), fs, RESP_FS))
    band = central(band, RESP_FS, WINDOW_SECONDS)
    period, quality = acf_period(band, RESP_FS, 60.0 / SEARCH_PER_MINUTE[1], 60.0 / SEARCH_PER_MINUTE[0])
    if period is None:
        return None, 0.0
    rate = 60.0 / period
    freqs, power = signal.welch(band, fs=RESP_FS, nperseg=band.size, nfft=4096)
    in_range = (freqs >= SEARCH_PER_MINUTE[0] / 60.0) & (freqs <= SEARCH_PER_MINUTE[1] / 60.0)
    spectral = 60.0 * freqs[in_range][np.argmax(power[in_range])]
    if abs(spectral - rate) > AGREEMENT_PER_MINUTE:
        return None, quality
    return rate, quality
