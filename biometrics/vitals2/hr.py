from __future__ import annotations

from collections import deque
from fractions import Fraction
from functools import lru_cache
from typing import List, NamedTuple, Optional

import numpy as np
from scipy import signal

from vitals2.gates import (HR_MAX_MOTION, HR_MAX_OCTAVE, HR_MIN_EVIDENCE, HR_MIN_QUALITY, HR_MIN_SUPPORT,
                           HR_RANGE)

WORK_FS = 100.0
ENVELOPE_FS = 50.0
# The envelope of this band has one bump per heartbeat's vibration burst.
BAND = (8.0, 25.0)
ENVELOPE_LOWPASS = 5.0
# Removes the beat-amplitude swing breathing causes, which otherwise reads as a fast rate.
ENVELOPE_HIGHPASS = 0.5
WINDOW_SECONDS = 10
HOP_SECONDS = 5
# Filter context needed on each side of a window.
EDGE_SECONDS = 5
BATCH_SECONDS = 60
# Signal a batch needs: a minute of new windows plus one window and both edges.
BUFFER_SECONDS = BATCH_SECONDS + WINDOW_SECONDS + 2 * EDGE_SECONDS
# Searched beyond the gate so rates near its edges still form a peak.
GRID_BPM = (float(HR_RANGE[0]), 150.0)
GRID_STEP = 0.01
# An autocorrelation peak counts as evidence from this prominence, spread by
# this width in log period.
PROMINENCE_MIN = 0.05
PEAK_WIDTH = 0.03
# Evidence at twice a rate counts against it while the double is a plausible
# sleeping rate.
OCTAVE_WEIGHT = 0.5
OCTAVE_DOUBLE_MAX = 100.0
# Flat prior over sleeping rates, falling off outside them.
PRIOR_RANGE = (45.0, 100.0)
PRIOR_WEIGHT = 0.2
KAPPA = 12.0
# Random walk per hop in log bpm, and the chance of a jump anywhere.
STEP_SIGMA = 0.03
JUMP = 1e-3
QUALITY_TOLERANCE = 0.05
# Neighbourhoods for the support and octave gates; a window is final once the
# later of them has arrived.
SUPPORT_HOPS = 3
OCTAVE_HOPS = 6
REPORT_DELAY_SECONDS = WINDOW_SECONDS + EDGE_SECONDS + OCTAVE_HOPS * HOP_SECONDS
# A second is movement when its cardiac-band amplitude is this many times the
# median of the past MOTION_HISTORY_SECONDS.
MOTION_RATIO = 3.0
MOTION_HISTORY_SECONDS = 300
RESET_GAP_SECONDS = 600

GRID = np.exp(np.arange(np.log(GRID_BPM[0]), np.log(GRID_BPM[1]) + 1e-9, GRID_STEP))
_LOG_GRID = np.log(GRID)
_OCTAVE = int(round(np.log(2.0) / GRID_STEP))
_BAND_SOS = signal.butter(4, BAND, btype='bandpass', fs=WORK_FS, output='sos')
_LOWPASS_SOS = signal.butter(2, ENVELOPE_LOWPASS, btype='lowpass', fs=WORK_FS, output='sos')
_HIGHPASS_SOS = signal.butter(2, ENVELOPE_HIGHPASS, btype='highpass', fs=WORK_FS, output='sos')


def _transition() -> np.ndarray:
    step = _LOG_GRID[:, None] - _LOG_GRID[None, :]
    walk = np.exp(-0.5 * (step / STEP_SIGMA) ** 2)
    walk /= walk.sum(axis=1, keepdims=True)
    return (1 - JUMP) * walk + JUMP / GRID.size


def _log_prior() -> np.ndarray:
    outside = (np.maximum(np.log(PRIOR_RANGE[0]) - _LOG_GRID, 0)
               + np.maximum(_LOG_GRID - np.log(PRIOR_RANGE[1]), 0))
    return -PRIOR_WEIGHT * (outside / 0.1) ** 2


TRANSITION = _transition()
LOG_PRIOR = _log_prior()


class HrWindow(NamedTuple):
    start: int
    bpm: Optional[float]  # None unless every gate passed
    quality: float  # posterior mass within QUALITY_TOLERANCE of the track
    track: float  # the tracked rate before gating, NaN without evidence
    envelope: Optional[np.ndarray]  # the window's cardiac envelope at ENVELOPE_FS
    motion: float = 0.0  # share of the window's seconds moving or masked; 1 for a window the stream missed


def resample(values: np.ndarray, fs: float, target_fs: float) -> np.ndarray:
    ratio = Fraction(int(round(target_fs)), int(round(fs))).limit_denominator(1000)
    return signal.resample_poly(values - np.median(values), ratio.numerator, ratio.denominator)


def central(values: np.ndarray, fs: float, seconds: float) -> np.ndarray:
    keep = int(round(seconds * fs))
    if values.size <= keep:
        return values
    start = (values.size - keep) // 2
    return values[start:start + keep]


@lru_cache(maxsize=8)
def _polyphase(up: int, down: int) -> np.ndarray:
    # The filter resample_poly designs by default, built once per ratio.
    return signal.firwin(20 * max(up, down) + 1, 1.0 / max(up, down), window=('kaiser', 5.0))


def _to_work_rate(values: np.ndarray, fs: float) -> np.ndarray:
    ratio = Fraction(int(round(WORK_FS)), int(round(fs))).limit_denominator(1000)
    centred = values - np.median(values)
    if ratio.numerator == ratio.denominator:
        return centred
    return signal.resample_poly(centred, ratio.numerator, ratio.denominator,
                                window=_polyphase(ratio.numerator, ratio.denominator))


def envelope(values: np.ndarray, fs: float) -> tuple[np.ndarray, np.ndarray]:
    """Cardiac envelope at ENVELOPE_FS, and the band-passed signal at WORK_FS."""
    band = signal.sosfiltfilt(_BAND_SOS, _to_work_rate(np.asarray(values, dtype=np.float64), fs))
    smooth = signal.sosfiltfilt(_HIGHPASS_SOS, signal.sosfiltfilt(_LOWPASS_SOS, np.abs(band)))
    return smooth[::int(round(WORK_FS / ENVELOPE_FS))], band


def _autocorrelation(windows: np.ndarray) -> np.ndarray:
    """Unbiased autocorrelation of each row, scaled so lag 0 is 1 (zeros for a flat row)."""
    size = windows.shape[1]
    centred = windows - windows.mean(axis=1, keepdims=True)
    nfft = 1 << int(np.ceil(np.log2(2 * size)))
    spectrum = np.fft.rfft(centred, nfft, axis=1)
    acf = np.fft.irfft(spectrum * np.conj(spectrum), nfft, axis=1)[:, :size]
    zero = acf[:, :1]
    acf = np.where(zero > 0, acf / np.where(zero > 0, zero, 1.0), 0.0)
    return acf * size / (size - np.arange(size))


def evidence(windows: np.ndarray) -> np.ndarray:
    """Periodicity evidence over GRID for each envelope window (rows).

    Each local maximum of the window's autocorrelation spreads its prominence
    (height above the higher neighbouring trough) over the grid around its
    lag. A falling autocorrelation from drift or movement has no maxima, so it
    gives no evidence anywhere.
    """
    acf = _autocorrelation(windows)
    rows, lags = acf.shape
    low = max(1, int(np.floor(60.0 / GRID_BPM[1] * ENVELOPE_FS * 0.9)))
    high = min(lags - 2, int(np.ceil(60.0 / GRID_BPM[0] * ENVELOPE_FS * 1.1)))
    span = acf[:, low - 1:high + 2]
    inner = span[:, 1:-1]
    is_max = (inner > span[:, :-2]) & (inner >= span[:, 2:])
    is_min = (inner < span[:, :-2]) & (inner <= span[:, 2:])
    log_period = np.log(60.0 / GRID * ENVELOPE_FS)
    out = np.zeros((rows, GRID.size))
    for row in range(rows):
        peaks = np.flatnonzero(is_max[row])
        if peaks.size == 0:
            continue
        troughs = np.flatnonzero(is_min[row])
        values = inner[row]
        if troughs.size:
            index = np.searchsorted(troughs, peaks)
            left = np.where(index > 0, values[troughs[np.maximum(index - 1, 0)]], values[0])
            right = np.where(index < troughs.size, values[troughs[np.minimum(index, troughs.size - 1)]], values[-1])
        else:
            left, right = np.full(peaks.size, values[0]), np.full(peaks.size, values[-1])
        prominence = values[peaks] - np.maximum(left, right)
        keep = prominence >= PROMINENCE_MIN
        if not keep.any():
            continue
        peaks, prominence = peaks[keep], prominence[keep]
        y0, y1, y2 = span[row, peaks], span[row, peaks + 1], span[row, peaks + 2]
        curvature = y0 - 2 * y1 + y2
        offset = np.where(curvature < 0, 0.5 * (y0 - y2) / np.where(curvature < 0, curvature, -1.0), 0.0)
        lag = peaks + low + offset
        spread = np.exp(-0.5 * ((log_period[None, :] - np.log(lag)[:, None]) / PEAK_WIDTH) ** 2)
        out[row] = np.max(prominence[:, None] * spread, axis=0)
    return np.clip(out, 0.0, None)


def log_likelihood(scores: np.ndarray, moving: bool) -> np.ndarray:
    """Emission log-likelihood over GRID for one window's evidence; flat while moving."""
    if moving:
        return np.zeros(GRID.size)
    penalised = scores.copy()
    weight = OCTAVE_WEIGHT * (GRID[_OCTAVE:] <= OCTAVE_DOUBLE_MAX)
    penalised[:-_OCTAVE] -= weight * scores[_OCTAVE:]
    return KAPPA * np.clip(penalised, 0.0, None) + LOG_PRIOR


def track_point(posterior: np.ndarray) -> tuple[float, float]:
    """The tracked rate (bpm) and the posterior mass within QUALITY_TOLERANCE of it."""
    near = np.abs(_LOG_GRID - _LOG_GRID[int(np.argmax(posterior))]) <= QUALITY_TOLERANCE
    mass = posterior * near
    quality = float(mass.sum())
    return float(np.exp((mass * _LOG_GRID).sum() / max(quality, 1e-12))), quality


def _band_max(mean_scores: np.ndarray, index: int) -> float:
    if index < 0 or index >= GRID.size:
        return 0.0
    return float(mean_scores[max(0, index - 3):min(GRID.size, index + 4)].max())


class _Window:
    __slots__ = ('start', 'scores', 'best', 'track', 'quality', 'motion', 'envelope')

    def __init__(self, start, scores, best, track, quality, motion, envelope):
        self.start, self.scores, self.best, self.track = start, scores, best, track
        self.quality, self.motion, self.envelope = quality, motion, envelope

    def agrees(self) -> bool:
        return bool(np.isfinite(self.best) and abs(np.log(self.best / self.track)) <= QUALITY_TOLERANCE)


def _gate(windows: List[_Window], index: int) -> Optional[float]:
    """The window's rate when every gate passes over the neighbours present, else None."""
    window = windows[index]
    if not np.isfinite(window.track):
        return None
    near = windows[max(0, index - SUPPORT_HOPS):index + SUPPORT_HOPS + 1]
    support = float(np.mean([other.agrees() for other in near]))
    wide = windows[max(0, index - OCTAVE_HOPS):index + OCTAVE_HOPS + 1]
    mean_scores = np.mean([other.scores for other in wide], axis=0)
    at = int(np.clip(np.round((np.log(window.track) - _LOG_GRID[0]) / GRID_STEP), 0, GRID.size - 1))
    level = _band_max(mean_scores, at) + 1e-9
    double = _band_max(mean_scores, at + _OCTAVE) / level
    passed = (window.quality >= HR_MIN_QUALITY and support >= HR_MIN_SUPPORT and window.motion <= HR_MAX_MOTION
              and double <= HR_MAX_OCTAVE and level >= HR_MIN_EVIDENCE
              and HR_RANGE[0] <= window.track <= HR_RANGE[1])
    return window.track if passed else None


class HrTracker:
    """One side's heart rate from the piezo signal, a batch at a time.

    Each step takes the most recent BUFFER_SECONDS (or more) of cleaned signal
    ending at `end`, computes evidence for every 10 s window on the 5 s grid
    not yet seen, advances a forward filter over a log-bpm grid, and returns
    the windows whose gate neighbourhoods are complete, REPORT_DELAY_SECONDS
    behind `end`. Windows the stream missed are filled as windows without
    evidence; a gap longer than RESET_GAP_SECONDS returns the windows still
    waiting, judged on the neighbours present, and starts over.
    """

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        # Windows still waiting for later neighbours are dropped; call flush() first to keep them.
        self._forward: Optional[np.ndarray] = None
        self._next_start: Optional[int] = None
        self._windows: List[_Window] = []
        self._pending = 0  # index in _windows of the first window not yet returned
        self._next_second: Optional[int] = None
        self._amplitudes: deque = deque(maxlen=MOTION_HISTORY_SECONDS)
        self._moving: dict = {}

    def step(self, samples: np.ndarray, fs: float, end: float, bad: Optional[np.ndarray] = None) -> List[HrWindow]:
        samples = np.asarray(samples, dtype=np.float64)
        if bad is not None and len(bad) != samples.size:
            raise ValueError('bad needs one flag per sample')
        if samples.size == 0 or not np.all(np.isfinite(samples)):
            return []
        begin = end - samples.size / fs
        first = int(np.ceil((begin + EDGE_SECONDS) / HOP_SECONDS)) * HOP_SECONDS
        last = int(np.floor((end - EDGE_SECONDS - WINDOW_SECONDS) / HOP_SECONDS)) * HOP_SECONDS
        stale: List[HrWindow] = []
        if self._next_start is not None and first - self._next_start > RESET_GAP_SECONDS:
            stale = self.flush()
            self.reset()
        return stale + self._step_windows(samples, fs, begin, end, first, last, bad)

    def _step_windows(self, samples: np.ndarray, fs: float, begin: float, end: float, first: int, last: int,
                      bad: Optional[np.ndarray]) -> List[HrWindow]:
        if self._next_start is not None:
            for start in range(self._next_start, min(first, last + HOP_SECONDS), HOP_SECONDS):
                self._add(start, None, 1.0, None)
            first = max(first, self._next_start)
        if last < first:
            return self._finish(final=False)
        env, band = envelope(samples, fs)
        self._note_motion(band, begin, end, fs, bad)
        size = int(round(WINDOW_SECONDS * ENVELOPE_FS))
        starts = list(range(first, last + 1, HOP_SECONDS))
        offsets = [int(round((start - begin) * ENVELOPE_FS)) for start in starts]
        usable = [(start, offset) for start, offset in zip(starts, offsets) if 0 <= offset <= env.size - size]
        if usable:
            scores = evidence(np.stack([env[offset:offset + size] for _, offset in usable]))
            for (start, offset), row in zip(usable, scores):
                seconds = range(start, start + WINDOW_SECONDS)
                motion = float(np.mean([self._moving.get(second, True) for second in seconds]))
                self._add(start, row, motion, env[offset:offset + size].copy())
        return self._finish(final=False)

    def pending_from(self) -> Optional[int]:
        """Start of the oldest window not yet returned; every window before it has been."""
        if self._pending < len(self._windows):
            return self._windows[self._pending].start
        return self._next_start

    def flush(self) -> List[HrWindow]:
        """Return the windows still waiting for later neighbours, judged on those present."""
        return self._finish(final=True)

    def _add(self, start: int, scores: Optional[np.ndarray], motion: float, env: Optional[np.ndarray]) -> None:
        if scores is None:
            scores = np.zeros(GRID.size)
        moving = motion > HR_MAX_MOTION
        likelihood = log_likelihood(scores, moving)
        weights = np.exp(likelihood - likelihood.max())
        if self._forward is None:
            prior = np.full(GRID.size, 1.0 / GRID.size)
        else:
            # einsum rather than @: macOS Accelerate flags spurious overflows on this product.
            prior = np.einsum('i,ij->j', self._forward, TRANSITION)
        forward = prior * weights
        self._forward = forward / forward.sum()
        rate, quality = track_point(self._forward)
        has_evidence = env is not None
        best = float(GRID[int(np.argmax(scores))]) if scores.max() > 0 else float('nan')
        self._windows.append(_Window(start, scores, best, rate if has_evidence else float('nan'), quality,
                                     motion, env))
        self._next_start = start + HOP_SECONDS

    def _finish(self, final: bool) -> List[HrWindow]:
        out = []
        while self._pending < len(self._windows) and (final or self._pending + OCTAVE_HOPS < len(self._windows)):
            window = self._windows[self._pending]
            out.append(HrWindow(window.start, _gate(self._windows, self._pending), window.quality, window.track,
                                window.envelope, window.motion))
            self._pending += 1
        drop = max(0, self._pending - OCTAVE_HOPS)
        self._windows = self._windows[drop:]
        self._pending -= drop
        return out

    def _note_motion(self, band: np.ndarray, begin: float, end: float, fs: float, bad: Optional[np.ndarray]) -> None:
        first = int(np.ceil(begin + EDGE_SECONDS))
        if self._next_second is not None:
            first = max(first, self._next_second)
        for second in range(first, int(np.floor(end - EDGE_SECONDS))):
            a = int(round((second - begin) * WORK_FS))
            amplitude = float(np.sqrt(np.mean(band[a:a + int(WORK_FS)] ** 2)))
            self._amplitudes.append(np.log(amplitude + 1e-9))
            moving = self._amplitudes[-1] - float(np.median(self._amplitudes)) > np.log(MOTION_RATIO)
            if bad is not None:
                b = int(round((second - begin) * fs))
                moving = moving or bool(np.any(bad[max(0, b):b + int(round(fs))]))
            self._moving[second] = moving
            self._next_second = second + 1
        oldest = (self._next_start if self._next_start is not None else first) - HOP_SECONDS
        self._moving = {second: flag for second, flag in self._moving.items() if second >= oldest}


def estimate_hr(signal_values: np.ndarray, fs: float, bad: Optional[np.ndarray] = None,
                start: float = 0.0) -> List[HrWindow]:
    """Every window of a recording, run through a fresh tracker in minute batches as the stream does."""
    values = np.asarray(signal_values, dtype=np.float64)
    tracker = HrTracker()
    total = values.size / fs
    ends = list(np.arange(BUFFER_SECONDS, total, BATCH_SECONDS)) + [total]
    out: List[HrWindow] = []
    for end in ends:
        b = int(round(end * fs))
        a = max(0, b - int(round(BUFFER_SECONDS * fs)))
        out += tracker.step(values[a:b], fs, start + b / fs, None if bad is None else bad[a:b])
    return out + tracker.flush()
