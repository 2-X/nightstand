"""Per-second, two-sided presence state machine.

Capacitance decides each side on its own, with hysteresis and dwell. Piezo
only answers whether anyone in the bed is alive: piezo picks up the partner
through the frame, so it cannot say which side is occupied, but a bed whose
piezo is quiet on both sides for long enough is empty whatever the
capacitance says (bedding or an object left on it). A side's enter count
only runs once piezo has read alive since the frames started or last broke,
and it enters only if piezo read alive on enough seconds of its enter
window, so neither a window that starts on an empty bed nor one pump thump
enters an object before the quiet count catches up.
"""
from __future__ import annotations

import math
import numbers
from collections import deque
from dataclasses import dataclass
from functools import lru_cache
from typing import Dict, Optional

import numpy as np

SIDES = ('left', 'right')
# Both sides' piezo below their gate for this long means nobody is in the bed.
BED_QUIET_SECONDS = 90
# The gate sits this far above each side's learned empty-bed piezo floor.
PIEZO_ALIVE_MARGIN = 2.0
# A side enters only if piezo read alive on at least this many of the seconds
# in its enter window: someone getting into bed moves, one pump thump does not.
ENTER_ALIVE_SECONDS = 5
# Baseline tracking: fraction of the remaining error taken per quiet second
# (a ten minute time constant) and the most it may drift from calibration.
TRACK_RATE = 1.0 / 600
OFFSET_LIMIT = 3.0
# A longer hole in the frames breaks every dwell count.
FRAME_GAP_SECONDS = 60
# Magnitude above which a raw piezo sample is a glitch, not signal (the ADC
# clips at 2^24; int32 wraparound garbage is far larger either sign).
SANE_MAX_SAMPLE = 25_000_000


@dataclass(frozen=True)
class SideParams:
    enter_delta: float
    exit_delta: float
    enter_seconds: int = 20
    exit_seconds: int = 60


@dataclass(frozen=True)
class DetectorParams:
    left: SideParams
    right: SideParams
    piezo_floor: Dict[str, float]

    def __post_init__(self):
        for side in SIDES:
            floor = self.piezo_floor.get(side)
            if (not isinstance(floor, numbers.Real) or isinstance(floor, bool)
                    or not math.isfinite(floor) or floor <= 0):
                raise ValueError(f'piezo_floor[{side!r}] must be finite and positive, got {floor!r}')

    def for_side(self, side: str) -> SideParams:
        return self.left if side == 'left' else self.right


def piezo_range(samples) -> Optional[float]:
    """p98 - p2 of one record's samples with glitch samples dropped, or None.

    Equal to np.percentile's linear method bit for bit, at a fraction of its
    per-call cost; the analyzer calls this twice per RAW record.
    """
    if samples is None:
        return None
    values = np.asarray(samples)
    if values.size == 0:
        return None
    values = values.astype(np.int64, copy=False)
    sane = np.abs(values) <= SANE_MAX_SAMPLE
    if not sane.all():
        values = values[sane]
    if values.size == 0:
        return None
    kth, picks = _range_picks(values.size)
    ordered = np.partition(values, kth)
    low, high = (_lerp(int(ordered[lower]), int(ordered[upper]), gamma) for lower, upper, gamma in picks)
    return float(high - low)


@lru_cache(maxsize=32)
def _range_picks(size: int):
    """Partition points and (lower, upper, weight) for p2 and p98, as np.percentile computes them."""
    picks = []
    for quantile in (0.02, 0.98):
        virtual = (size - 1) * quantile
        lower = math.floor(virtual)
        picks.append((lower, min(lower + 1, size - 1), virtual - lower))
    kth = sorted({index for lower, upper, _ in picks for index in (lower, upper)})
    return kth, tuple(picks)


def _lerp(low: int, high: int, weight: float) -> float:
    # np.percentile's interpolation, including its switch at 0.5.
    diff = high - low
    if weight >= 0.5:
        return high - diff * (1 - weight)
    return low + diff * weight


class _SideState:
    __slots__ = ('occupied', 'enter_count', 'exit_count', 'offset', 'enter_alive')

    def __init__(self, enter_seconds: int):
        self.occupied = False
        self.enter_count = 0
        self.exit_count = 0
        self.offset = 0.0
        # Whether piezo read alive on each of the latest counted enter seconds.
        self.enter_alive: deque = deque(maxlen=max(1, enter_seconds))

    def reset_enter(self) -> None:
        self.enter_count = 0
        self.enter_alive.clear()

    def reset_counts(self) -> None:
        self.reset_enter()
        self.exit_count = 0


class PresenceDetector:
    """Feed one frame per second; both sides' states come back from every step."""

    def __init__(self, params: DetectorParams):
        self._params = params
        self._sides = {side: _SideState(params.for_side(side).enter_seconds) for side in SIDES}
        self._quiet_seconds = 0
        self._seen_alive = False
        self._last_t: Optional[int] = None

    def state(self) -> Dict[str, bool]:
        return {side: state.occupied for side, state in self._sides.items()}

    def offsets(self) -> Dict[str, float]:
        """How far each side's tracked empty baseline has moved from calibration."""
        return {side: state.offset for side, state in self._sides.items()}

    def step(self, t: int, cap: Dict[str, Optional[float]], piezo_range: Dict[str, Optional[float]]) -> Dict[str, bool]:
        # A long hole, a repeated second or a clock step back breaks the frames.
        if self._last_t is not None and not 0 < t - self._last_t <= FRAME_GAP_SECONDS:
            self._quiet_seconds = 0
            self._seen_alive = False
            for state in self._sides.values():
                state.reset_counts()
        self._last_t = t
        alive = self._update_quiet(piezo_range)
        self._seen_alive = self._seen_alive or alive
        bed_empty = self._quiet_seconds >= BED_QUIET_SECONDS
        may_enter = self._seen_alive and not bed_empty
        for side in SIDES:
            self._step_side(side, _reading(cap.get(side)), bed_empty, may_enter, alive)
        return self.state()

    def _update_quiet(self, piezo: Dict[str, Optional[float]]) -> bool:
        """Count quiet seconds; True when either side reads alive."""
        # A side with no piezo reading this second leaves the count where it is.
        known = True
        for side in SIDES:
            value = _reading(piezo.get(side))
            if value is None:
                known = False
            elif value >= self._params.piezo_floor[side] * PIEZO_ALIVE_MARGIN:
                self._quiet_seconds = 0
                return True
        if known:
            self._quiet_seconds += 1
        return False

    def _step_side(self, side: str, delta: Optional[float], bed_empty: bool, may_enter: bool,
                   alive: bool) -> None:
        params = self._params.for_side(side)
        state = self._sides[side]
        if bed_empty:
            state.occupied = False
            state.reset_counts()
        if not may_enter:
            state.reset_enter()
        if delta is None:
            return
        if bed_empty and not state.occupied:
            _track_baseline(state, delta, params)
        level = delta - state.offset
        if not state.occupied:
            if not may_enter or level <= params.enter_delta:
                state.reset_enter()
                return
            state.enter_count += 1
            state.enter_alive.append(alive)
            needed = min(ENTER_ALIVE_SECONDS, params.enter_seconds)
            if state.enter_count >= params.enter_seconds and sum(state.enter_alive) >= needed:
                state.occupied = True
                state.reset_counts()
        else:
            state.exit_count = state.exit_count + 1 if level < params.exit_delta else 0
            if state.exit_count >= params.exit_seconds:
                state.occupied = False
                state.reset_counts()


def _reading(value: Optional[float]) -> Optional[float]:
    """None for a missing reading, NaN included."""
    return None if value is None or math.isnan(value) else value


def _track_baseline(state: _SideState, delta: float, params: SideParams) -> None:
    """Follow slow bedding drift on an empty bed; ignore anything as large as a person leaving."""
    error = delta - state.offset
    if abs(error) >= params.exit_delta:
        return
    state.offset = max(-OFFSET_LIMIT, min(OFFSET_LIMIT, state.offset + TRACK_RATE * error))
