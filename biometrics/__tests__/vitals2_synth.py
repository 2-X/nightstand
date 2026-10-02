"""Synthetic piezo signals with a known heart and breathing rate.

A ballistocardiogram beat is an H-I-J-K-L complex with several local maxima,
modelled here as five Gaussian lobes. Amplitudes are in raw ADC counts, in the
range an occupied Pod 5 side produces.
"""
from __future__ import annotations

import numpy as np

FS = 500.0
# (amplitude relative to J, centre seconds after beat onset, width seconds)
BEAT_LOBES = ((0.3, 0.00, 0.015), (-0.5, 0.05, 0.015), (1.0, 0.10, 0.02), (-0.6, 0.16, 0.02), (0.3, 0.22, 0.025))


def beat_times(seconds: float, bpm: float, jitter_ms: float = 0.0, seed: int = 0) -> np.ndarray:
    """Beat onsets with independent Gaussian jitter on each interval."""
    rng = np.random.default_rng(seed)
    period = 60.0 / bpm
    count = int(seconds / period) + 2
    intervals = period + rng.normal(0.0, jitter_ms / 1000.0, count)
    return np.cumsum(intervals) - intervals[0]


def varying_beat_times(seconds: float, bpm_at, jitter_ms: float = 0.0, seed: int = 0) -> np.ndarray:
    """Beat onsets for a rate that changes over time; bpm_at(t) is the rate at t seconds."""
    rng = np.random.default_rng(seed)
    onsets, t = [], 0.0
    while t < seconds:
        onsets.append(t)
        t += 60.0 / bpm_at(t) + rng.normal(0.0, jitter_ms / 1000.0)
    return np.array(onsets)


def _add_beat(out: np.ndarray, onset: float, scale_all: float) -> None:
    first = max(0, int((onset - 0.05) * FS))
    last = min(out.size, int((onset + 0.35) * FS) + 1)
    if first >= last:
        return
    t = np.arange(first, last) / FS
    for scale, centre, width in BEAT_LOBES:
        out[first:last] += scale_all * scale * np.exp(-((t - onset - centre) / width) ** 2)


def bcg(seconds: float, bpm: float = 60.0, amplitude: float = 200_000.0, jitter_ms: float = 0.0,
        second_hump: float = 0.0, seed: int = 0, times: np.ndarray | None = None,
        modulation: float = 0.0, per_minute: float = 15.0) -> np.ndarray:
    """A beat train; second_hump adds a copy of each beat half a period later, scaled.

    modulation scales each beat by 1 + modulation * sin(breathing phase), as
    breathing does to a real ballistocardiogram.
    """
    out = np.zeros(int(seconds * FS))
    onsets = beat_times(seconds, bpm, jitter_ms, seed) if times is None else times
    for onset in onsets:
        scale = 1.0 + modulation * np.sin(2 * np.pi * per_minute / 60.0 * onset)
        _add_beat(out, onset, scale)
        if second_hump:
            _add_beat(out, onset + 30.0 / bpm, second_hump * scale)
    return amplitude * out


def breathing(seconds: float, per_minute: float, amplitude: float = 1_000_000.0) -> np.ndarray:
    t = np.arange(int(seconds * FS)) / FS
    return amplitude * np.sin(2 * np.pi * per_minute / 60.0 * t)


def noise(seconds: float, level: float = 20_000.0, seed: int = 1) -> np.ndarray:
    return np.random.default_rng(seed).normal(0.0, level, int(seconds * FS))


def pink_noise(seconds: float, level: float = 50_000.0, seed: int = 2) -> np.ndarray:
    """1/f noise with standard deviation level, like body movement and drift."""
    size = int(seconds * FS)
    spectrum = np.fft.rfft(np.random.default_rng(seed).normal(0.0, 1.0, size))
    freqs = np.fft.rfftfreq(size, 1.0 / FS)
    spectrum[1:] /= np.sqrt(freqs[1:])
    spectrum[0] = 0.0
    shaped = np.fft.irfft(spectrum, size)
    return level * shaped / shaped.std()


def piezo(seconds: float, bpm: float = 60.0, per_minute: float = 15.0, noise_level: float = 20_000.0,
          jitter_ms: float = 0.0, seed: int = 0, offset: float = 500_000.0, modulation: float = 0.0,
          pink_level: float = 0.0) -> np.ndarray:
    """Heart plus breathing plus noise, as int32 samples like a RAW record."""
    total = (bcg(seconds, bpm, jitter_ms=jitter_ms, seed=seed, modulation=modulation, per_minute=per_minute)
             + breathing(seconds, per_minute) + noise(seconds, noise_level, seed + 1) + offset)
    if pink_level:
        total += pink_noise(seconds, pink_level, seed + 2)
    return np.clip(np.round(total), -8_388_608, 8_388_607).astype(np.int32)
