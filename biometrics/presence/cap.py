"""Capacitance rise over the empty-bed baseline, per side."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional, Sequence, Tuple

# A capacitance reading stands in for this many seconds of piezo frames.
CAP_HOLD_SECONDS = 5


@dataclass(frozen=True)
class CapBaseline:
    """Empty-bed channel means (out, cen, in) and the noise of their sum."""
    mean: Tuple[float, ...]
    noise: float


def cap_delta(channels: Optional[Sequence[Optional[float]]], baseline: CapBaseline) -> Optional[float]:
    """Sum of the channel rises over the baseline, or None with no reading.

    channels come from presence.sensors.read_cap. A channel without a
    reading is left out and the others are scaled up to the full count, so
    one dead channel does not read as a drop in occupancy. Finite channels
    that overflow the sum give no reading rather than infinity.
    """
    if channels is None:
        return None
    total = 0.0
    used = 0
    for index, value in enumerate(channels):
        if value is None:
            continue
        total += value - baseline.mean[index]
        used += 1
    if used == 0:
        return None
    delta = total * len(channels) / used
    if not math.isfinite(delta) and _all_finite(channels, baseline.mean):
        return None
    return delta


def _all_finite(channels, mean) -> bool:
    return all(value is None or math.isfinite(value) for value in channels) and all(math.isfinite(value) for value in mean)
