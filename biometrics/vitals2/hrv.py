from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import scipy.signal as sps

from vitals2.gates import HRV_MIN_COVERAGE
from vitals2.hr import resample

WINDOW_SECONDS = 300
# Beats are timed at this rate: 4 ms steps add under 0.1 ms to a typical RMSSD
# and halve the memory of a five-minute window.
HRV_FS = 250.0
LEARN_SECONDS = 60
REFRESH_SECONDS = 300
# Template spans this share of the beat period before and after the J peak.
BEFORE_PERIOD = 0.25
AFTER_PERIOD = 0.35
MIN_TEMPLATE_BEATS = 20
# A beat is a normalized cross-correlation peak at least this high.
MIN_NCC = 0.4
# An interval is kept within this fraction of the local period and of its predecessor.
INTERVAL_TOLERANCE = 0.2
MIN_PAIRS = 20

_BAND = sps.butter(4, [1.0, 15.0], btype='bandpass', fs=HRV_FS, output='sos')


def beat_band(values: np.ndarray, fs: float) -> np.ndarray:
    """The 1 to 15 Hz band at HRV_FS, where J-peak timing lives."""
    return sps.sosfiltfilt(_BAND, resample(np.asarray(values, dtype=np.float64), fs, HRV_FS))


def _bad_at_hrv_rate(bad: np.ndarray, fs: float, size: int) -> np.ndarray:
    """A bad-sample mask at HRV_FS: a sample is bad when any sample it replaces was."""
    step = max(1, int(round(fs / HRV_FS)))
    usable = min(bad.size // step, size)
    out = np.zeros(size, dtype=bool)
    out[:usable] = bad[:usable * step].reshape(usable, step).any(axis=1)
    return out


@dataclass(frozen=True)
class BeatTemplate:
    """One side's median beat shape at HRV_FS, zero-mean and unit-norm."""
    shape: np.ndarray
    offset: int  # samples from the template start to the J peak
    period: float  # seconds
    learned_at: int

    @classmethod
    def learn(cls, signal: np.ndarray, fs: float, period: float, learned_at: int) -> BeatTemplate | None:
        """Median beat of a cleaned signal whose beat period is known, or None with too few beats."""
        band = beat_band(signal, fs)
        before = int(BEFORE_PERIOD * period * HRV_FS)
        after = int(AFTER_PERIOD * period * HRV_FS)
        peaks, _ = sps.find_peaks(band, distance=max(1, int(0.7 * period * HRV_FS)))
        peaks = peaks[(peaks >= before) & (peaks + after <= band.size)]
        if peaks.size < MIN_TEMPLATE_BEATS:
            return None
        beats = np.stack([band[peak - before:peak + after] for peak in peaks])
        shape = np.median(beats, axis=0)
        shape = shape - shape.mean()
        norm = np.linalg.norm(shape)
        if norm == 0:
            return None
        return cls(shape=shape / norm, offset=before, period=period, learned_at=learned_at)

    def is_stale(self, now: int) -> bool:
        return now - self.learned_at >= REFRESH_SECONDS


def _ncc(band: np.ndarray, shape: np.ndarray) -> np.ndarray:
    size = shape.size
    numerator = sps.correlate(band, shape, mode='valid')
    sums = np.concatenate(([0.0], np.cumsum(band)))
    squares = np.concatenate(([0.0], np.cumsum(band ** 2)))
    window_sum = sums[size:] - sums[:-size]
    window_squares = squares[size:] - squares[:-size]
    energy = np.sqrt(np.maximum(window_squares - window_sum ** 2 / size, 1e-12))
    return numerator / energy


def jj_intervals(signal: np.ndarray, fs: float, template: BeatTemplate,
                 bad: np.ndarray | None = None) -> np.ndarray:
    """Beat-to-beat intervals in ms, in order, with NaN where an interval was rejected.

    Beats are normalized cross-correlation peaks between the cleaned signal's
    beat band and the template. An interval is kept when it is within
    INTERVAL_TOLERANCE of the median interval and of the interval before it,
    and does not span a bad sample.
    """
    band = beat_band(signal, fs)
    if band.size < template.shape.size * 2:
        return np.array([])
    ncc = _ncc(band, template.shape)
    beats, _ = sps.find_peaks(ncc, height=MIN_NCC, distance=max(1, int(0.7 * template.period * HRV_FS)))
    if beats.size < 3:
        return np.array([])
    beats = beats + template.offset
    intervals = np.diff(beats) / HRV_FS * 1000.0
    period = float(np.median(intervals))
    keep = np.abs(intervals - period) < INTERVAL_TOLERANCE * period
    keep[1:] &= np.abs(intervals[1:] / intervals[:-1] - 1.0) < INTERVAL_TOLERANCE
    if bad is not None and bad.any():
        bad_before = np.concatenate(([0], np.cumsum(_bad_at_hrv_rate(bad, fs, band.size))))
        spans = bad_before[np.minimum(beats[1:], band.size)] - bad_before[np.minimum(beats[:-1], band.size)]
        keep &= spans == 0
    return np.where(keep, intervals, np.nan)


def rmssd_sdnn(intervals_ms: np.ndarray, window_seconds: float) -> tuple[float | None, float | None, float]:
    """RMSSD and SDNN in ms and the share of the window the kept intervals cover.

    RMSSD uses only successive kept pairs. Both are None when coverage is
    below the gate or there are fewer than MIN_PAIRS values.
    """
    intervals = np.asarray(intervals_ms, dtype=np.float64)
    kept = ~np.isnan(intervals)
    coverage = float(np.nansum(intervals) / (window_seconds * 1000.0)) if kept.any() else 0.0
    coverage = min(coverage, 1.0)
    if coverage < HRV_MIN_COVERAGE:
        return None, None, coverage
    pairs = kept[1:] & kept[:-1]
    differences = np.diff(intervals)[pairs]
    rmssd = float(np.sqrt(np.mean(differences ** 2))) if differences.size >= MIN_PAIRS else None
    sdnn = float(np.std(intervals[kept])) if kept.sum() >= MIN_PAIRS else None
    return rmssd, sdnn, coverage
