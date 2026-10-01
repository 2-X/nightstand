"""What piezo records say about themselves: rate, length, sensors per side and cadence.

The presence detector counts frames as seconds, so a format whose piezo
records do not come once a second must not drive it. Vitals read the rate
from here rather than assuming one.
"""
from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass
from typing import Optional

import numpy as np

ONE_PER_SECOND_SHARE = 0.9
CADENCE_RECORDS = 120
# A longer step is a gap in the data, not a cadence.
MAX_GAP_SECONDS = 60
_MAX_SECOND = 2 ** 62


@dataclass(frozen=True)
class PiezoLayout:
    freq: Optional[int]
    samples: int
    sensors_per_side: int

    def record_seconds(self) -> Optional[float]:
        return self.samples / self.freq if self.freq else None


def piezo_layout(record) -> Optional[PiezoLayout]:
    if not isinstance(record, dict) or record.get('type') != 'piezo-dual':
        return None
    samples = _sample_count(record.get('left1'))
    if samples is None:
        return None
    freq = record.get('freq')
    usable = (isinstance(freq, (int, float)) and not isinstance(freq, bool)
              and math.isfinite(freq) and freq > 0)
    return PiezoLayout(freq=int(freq) if usable else None, samples=samples,
                       sensors_per_side=2 if 'left2' in record else 1)


def _sample_count(samples) -> Optional[int]:
    if isinstance(samples, (bytes, bytearray)):
        return len(samples) // 4
    if isinstance(samples, np.ndarray):
        return int(samples.size)
    return None


def one_per_second_share(seconds) -> float:
    """Share of steps between distinct record seconds, gaps left out, that are one second."""
    values = seconds if isinstance(seconds, np.ndarray) else list(seconds)
    unique = np.unique(np.asarray(values, dtype=np.int64))
    steps = np.diff(unique)
    steps = steps[steps <= MAX_GAP_SECONDS]
    return float(np.count_nonzero(steps == 1) / steps.size) if steps.size else 0.0


class CadenceCheck:
    """Whether recent piezo records come once a second; None until enough have arrived."""

    def __init__(self, records: int = CADENCE_RECORDS):
        self._seconds = deque(maxlen=records)

    def add(self, ts) -> None:
        try:
            second = int(ts)
        except (TypeError, ValueError, OverflowError):
            return
        if abs(second) < _MAX_SECOND:
            self._seconds.append(second)

    def ok(self) -> Optional[bool]:
        if len(self._seconds) < self._seconds.maxlen:
            return None
        return one_per_second_share(self._seconds) >= ONE_PER_SECOND_SHARE
