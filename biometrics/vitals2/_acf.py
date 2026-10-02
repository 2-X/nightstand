from __future__ import annotations

import numpy as np
from scipy import signal

# A submultiple peak at least this fraction of the best peak's height can be
# the fundamental.
HARMONIC_RATIO = 0.8
# How close (fraction of the lag) a peak must be to a submultiple or double.
HARMONIC_TOLERANCE = 0.08
# Unbiased height at double the fundamental over the mean of the heights at
# one and three times it, which cancels the steady fall-off beat jitter causes.
# A single beat per period measures about 0.8 to 1.1; a smaller second hump in
# every period lifts it above ALTERNATION_RATIO, so the double is the period.
# Between the two the window is ambiguous.
ALTERNATION_RATIO = 1.15
NO_ALTERNATION_RATIO = 1.06
# A previous period settles a choice only when a candidate lies this close to it.
PREVIOUS_TOLERANCE = 0.10
# Quality reported for an ambiguous window nothing settles; below every gate.
AMBIGUOUS_QUALITY = 0.2


def normalized_acf(values: np.ndarray) -> np.ndarray:
    """Biased autocorrelation scaled so lag 0 is 1 (all zeros for a flat input)."""
    centered = values - values.mean()
    size = centered.size
    spectrum = np.fft.rfft(centered, 2 * size)
    acf = np.fft.irfft(spectrum * np.conj(spectrum))[:size]
    if acf[0] <= 0:
        return np.zeros(size)
    return acf / acf[0]


def _near(peaks: np.ndarray, heights: np.ndarray, target: float) -> int | None:
    close = peaks[np.abs(peaks - target) <= HARMONIC_TOLERANCE * target]
    return int(close[np.argmax(heights[close])]) if close.size else None


def acf_period(values: np.ndarray, fs: float, min_lag_s: float, max_lag_s: float,
               previous_period_s: float | None = None) -> tuple[float | None, float]:
    """Period in seconds from the autocorrelation peak, and its height as quality.

    Peaks are compared on the unbiased autocorrelation, and both end lags can
    be reported. The highest peak is walked down to its shortest submultiple
    that is nearly as high (the fundamental). A nearly as high peak at double
    the fundamental is the period when it stands clearly above the peaks at one
    and three times the fundamental (a smaller second hump in every period does
    this) and is no lower than the fundamental. With weaker evidence the window
    is ambiguous: previous_period_s decides when it lies within
    PREVIOUS_TOLERANCE of either candidate, otherwise the quality is capped at
    AMBIGUOUS_QUALITY. With no evidence the fundamental stands unless the
    previous period lies that close to the double, since two equal humps per
    beat look the same as one beat at twice the rate.
    """
    acf = normalized_acf(values)
    size = acf.size
    low = max(1, int(np.floor(min_lag_s * fs)))
    high = min(int(np.ceil(max_lag_s * fs)), size - 2)
    if high <= low + 1:
        return None, 0.0
    unbiased = acf * size / (size - np.arange(size))
    found, _ = signal.find_peaks(unbiased[low - 1:high + 2])
    peaks = found + low - 1
    peaks = peaks[(peaks >= low) & (peaks <= high)]
    peaks = peaks[unbiased[peaks] > 0]
    if peaks.size == 0:
        return None, 0.0
    best = int(peaks[np.argmax(unbiased[peaks])])
    floor = HARMONIC_RATIO * unbiased[best]
    fundamental = best
    for lag in peaks[(peaks < best) & (unbiased[peaks] >= floor)]:
        multiple = round(best / lag)
        if multiple >= 2 and abs(best - multiple * lag) <= HARMONIC_TOLERANCE * best:
            fundamental = int(lag)
            break
    chosen, settled = fundamental, True
    double = _near(peaks, unbiased, fundamental * 2)
    if double is not None and unbiased[double] >= HARMONIC_RATIO * unbiased[fundamental]:
        alternation = _alternation(unbiased, fundamental, double)
        near = _near_previous((fundamental, double), fs, previous_period_s)
        if alternation >= ALTERNATION_RATIO and unbiased[double] >= unbiased[fundamental]:
            chosen = double
        elif alternation >= NO_ALTERNATION_RATIO:
            chosen, settled = (near, True) if near is not None else (double, False)
        elif near is not None:
            chosen = near
    left, centre, right = unbiased[chosen - 1], unbiased[chosen], unbiased[chosen + 1]
    curvature = left - 2 * centre + right
    offset = 0.5 * (left - right) / curvature if curvature != 0 else 0.0
    quality = max(0.0, min(1.0, acf[chosen]))
    if not settled:
        quality = min(quality, AMBIGUOUS_QUALITY)
    return (chosen + offset) / fs, float(quality)


def _alternation(unbiased: np.ndarray, fundamental: int, double: int) -> float:
    """Height at the double over the mean height at one and three times the fundamental."""
    target = 3 * fundamental
    spread = max(1, int(HARMONIC_TOLERANCE * target))
    if target + spread < unbiased.size:
        third = float(unbiased[target - spread:target + spread + 1].max())
    else:
        third = float(unbiased[fundamental])
    odd = (unbiased[fundamental] + third) / 2
    return float(unbiased[double] / odd) if odd > 0 else float('inf')


def _near_previous(lags: tuple[int, int], fs: float, previous_period_s: float | None) -> int | None:
    """The lag closest to previous_period_s, if within PREVIOUS_TOLERANCE of it."""
    if previous_period_s is None:
        return None
    distances = [abs(np.log(lag / fs / previous_period_s)) for lag in lags]
    closest = int(np.argmin(distances))
    return lags[closest] if distances[closest] <= np.log(1.0 + PREVIOUS_TOLERANCE) else None
