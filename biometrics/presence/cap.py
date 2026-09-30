"""Capacitance rise over the empty-bed baseline, per side."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional, Sequence, Tuple

# capSense2 writes -1.0 for a value it has no reading for, on all eight of a
# side or on only some of them.
SENTINEL = -1.0
# The eight values arrive as four near-identical pairs; the fourth pair is a
# reference near zero, so the first three pairs are the channels.
CHANNEL_PAIRS = ((0, 1), (2, 3), (4, 5))
# A capacitance reading stands in for this many seconds of piezo frames.
CAP_HOLD_SECONDS = 5


@dataclass(frozen=True)
class CapBaseline:
    """Empty-bed channel means (out, cen, in) and the noise of their sum."""
    mean: Tuple[float, ...]
    noise: float


def cap_delta(values: Optional[Sequence[float]], baseline: CapBaseline) -> Optional[float]:
    """Sum of the three channel rises over the baseline, or None with no reading.

    A sentinel, None or NaN value is missing: a pair falls back to its other
    value, and a channel whose pair is all missing is left out and the
    remaining ones are scaled up to three channels, so one dead channel does
    not read as a drop in occupancy.
    """
    if values is None or len(values) < 6:
        return None
    total = 0.0
    used = 0
    for channel, (first, second) in enumerate(CHANNEL_PAIRS):
        readings = [value for value in (values[first], values[second])
                    if value is not None and value != SENTINEL and not math.isnan(value)]
        if not readings:
            continue
        total += sum(readings) / len(readings) - baseline.mean[channel]
        used += 1
    if used == 0:
        return None
    return total * len(CHANNEL_PAIRS) / used
