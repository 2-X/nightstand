from __future__ import annotations

import numpy as np

# Firmware dropout marker, written at the same index on both channels.
SENTINEL = 2147483647
# 24-bit ADC rails. Samples at either rail are clipped during movement.
RAIL_HIGH = 8388607
RAIL_LOW = -8388608
# Anything beyond 24 bits that is not the sentinel is int32 wraparound garbage.
GARBAGE_MAGNITUDE = 2 ** 24
# Sentinel runs up to this many samples (20 ms at 500 Hz) are interpolated
# and treated as good; longer runs are interpolated but marked bad.
MAX_SHORT_GAP = 10


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    edges = np.diff(np.concatenate(([0], mask.astype(np.int8), [0])))
    return list(zip(np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)))


def mask_artifacts(samples) -> tuple[np.ndarray, np.ndarray]:
    """Return float samples with dropouts interpolated, and a bad-sample mask.

    The mask marks clipped samples and dropout runs longer than MAX_SHORT_GAP.
    """
    raw = np.asarray(samples, dtype=np.int64)
    missing = (raw == SENTINEL) | (np.abs(raw) >= GARBAGE_MAGNITUDE)
    clipped = ((raw >= RAIL_HIGH) | (raw <= RAIL_LOW)) & ~missing
    cleaned = raw.astype(np.float64)
    bad = clipped.copy()
    if missing.all():
        return np.zeros(raw.size, dtype=np.float64), np.ones(raw.size, dtype=bool)
    if missing.any():
        index = np.arange(raw.size)
        cleaned[missing] = np.interp(index[missing], index[~missing], cleaned[~missing])
        for start, end in _runs(missing):
            if end - start > MAX_SHORT_GAP:
                bad[start:end] = True
    return cleaned, bad
