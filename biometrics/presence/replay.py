"""Run the presence detector over a stored night, and gather its inputs cheaply."""
from __future__ import annotations

from array import array
from typing import Dict, Iterable, Iterator, List, Optional, Sequence, Tuple

import numpy as np

from .cap import CAP_HOLD_SECONDS, CapBaseline, cap_delta
from .detector import SIDES, DetectorParams, PresenceDetector

# (unix seconds, capacitance delta per side, piezo range per side)
Frame = Tuple[int, Dict[str, Optional[float]], Dict[str, Optional[float]]]

# Seconds read back at a time, so a night never needs a full-size temporary.
CHUNK_SECONDS = 2048


def _in_time_order(frames: Iterable[Frame]) -> Iterator[Frame]:
    """Frames with every second that does not advance the clock dropped.

    The detector reads a repeated or backwards second as a break in the
    frames, which would restart every count. The first frame of a second
    stays, and a later frame stamped at or before the latest second seen is
    dropped. It holds one number, so a list and a one-shot iterator agree.
    """
    latest: Optional[int] = None
    for frame in frames:
        if latest is None or frame[0] > latest:
            latest = frame[0]
            yield frame


def replay(frames: Iterable[Frame], params: DetectorParams) -> Dict[str, List[Tuple[int, int]]]:
    """Occupied [start, end) intervals per side, in unix seconds.

    Steps the detector the live stream uses over the frames: an interval
    opens on the frame the detector turns a side on and closes on the frame
    it turns it off. Frames must come in time order; one that does not
    advance the clock is dropped.
    """
    detector = PresenceDetector(params)
    intervals: Dict[str, List[Tuple[int, int]]] = {side: [] for side in SIDES}
    opened: Dict[str, Optional[int]] = {side: None for side in SIDES}
    last_t: Optional[int] = None
    for t, cap, piezo in _in_time_order(frames):
        states = detector.step(t, cap, piezo)
        for side in SIDES:
            if states[side] and opened[side] is None:
                opened[side] = t
            elif not states[side] and opened[side] is not None:
                intervals[side].append((opened[side], t))
                opened[side] = None
        last_t = t
    for side in SIDES:
        if opened[side] is not None:
            intervals[side].append((opened[side], last_t + 1))
    return intervals


def occupied_level(frames: Iterable[Frame], intervals: Sequence[Tuple[int, int]], side: str) -> Tuple[Optional[float], int]:
    """Median capacitance delta over this side's occupied seconds, and how many there were."""
    values = array('d')
    index = 0
    for t, cap, _ in _in_time_order(frames):
        while index < len(intervals) and t >= intervals[index][1]:
            index += 1
        if index == len(intervals):
            break
        if intervals[index][0] <= t:
            delta = cap.get(side)
            if delta is not None:
                values.append(delta)
    if not values:
        return None, 0
    return float(np.median(np.frombuffer(values, dtype=np.float64))), len(values)


class FrameCollector:
    """Per-record presence inputs for both sides, kept as compact arrays.

    The analyzer feeds it every capSense2 and piezo-dual record while it
    decodes RAW files, before the other side's data is dropped. A record costs
    16 bytes here, so a 25 hour window holds about 4 MB, and reading it back
    works in small pieces, so that adds well under 1 MB. Values are stored as
    float32, so one a hair from a threshold may step differently than the
    live float64 reading did.
    """

    def __init__(self, baselines: Dict[str, CapBaseline]):
        self._baselines = baselines
        self._cap_ts = array('q')
        self._cap = {side: array('f') for side in SIDES}
        self._piezo_ts = array('q')
        self._piezo = {side: array('f') for side in SIDES}

    def add_cap(self, ts: int, left_values: Sequence[float], right_values: Sequence[float]) -> None:
        self._cap_ts.append(int(ts))
        for side, values in (('left', left_values), ('right', right_values)):
            delta = cap_delta(values, self._baselines[side])
            self._cap[side].append(float('nan') if delta is None else delta)

    def add_piezo(self, ts: int, left_range: Optional[float], right_range: Optional[float]) -> None:
        self._piezo_ts.append(int(ts))
        for side, value in (('left', left_range), ('right', right_range)):
            self._piezo[side].append(float('nan') if value is None else value)

    def nbytes(self) -> int:
        arrays = [self._cap_ts, self._piezo_ts, *self._cap.values(), *self._piezo.values()]
        return sum(len(values) * values.itemsize for values in arrays)

    def cap_coverage(self) -> float:
        """Share of piezo seconds with a capacitance reading on at least one side."""
        seconds = covered = 0
        for chunk_seconds, cap, _ in self._chunks():
            seconds += chunk_seconds.size
            covered += int(np.count_nonzero(~(np.isnan(cap['left']) & np.isnan(cap['right']))))
        return covered / seconds if seconds else 0.0

    def frames(self) -> Iterator[Frame]:
        """One frame per piezo second in time order; a new iterator on every call."""
        for seconds, cap, piezo in self._chunks():
            cap_rows = {side: cap[side].tolist() for side in SIDES}
            piezo_rows = {side: piezo[side].tolist() for side in SIDES}
            for index, second in enumerate(seconds.tolist()):
                yield (
                    second,
                    {side: _optional(cap_rows[side][index]) for side in SIDES},
                    {side: _optional(piezo_rows[side][index]) for side in SIDES},
                )

    def _chunks(self):
        """(seconds, capacitance held per second, piezo range) for CHUNK_SECONDS at a time.

        Views of the arrays live only inside one piece, so records can still
        be added while an iterator is open; they are left out of it.
        """
        piezo_count, cap_count = len(self._piezo_ts), len(self._cap_ts)
        piezo_pick = _time_order(_view(self._piezo_ts, np.int64, piezo_count), strict=True)
        cap_ts = _view(self._cap_ts, np.int64, cap_count)
        cap_pick = _time_order(cap_ts, strict=False)
        cap_sorted = None if cap_pick is None else cap_ts[cap_pick]
        del cap_ts
        total = piezo_count if piezo_pick is None else piezo_pick.size
        for start in range(0, total, CHUNK_SECONDS):
            rows = slice(start, start + CHUNK_SECONDS) if piezo_pick is None else piezo_pick[start:start + CHUNK_SECONDS]
            seconds = np.array(_view(self._piezo_ts, np.int64, piezo_count)[rows])
            piezo = {side: np.array(_view(self._piezo[side], np.float32, piezo_count)[rows]) for side in SIDES}
            cap = self._cap_held_at(seconds, cap_count, cap_pick, cap_sorted)
            yield seconds, cap, piezo

    def _cap_held_at(self, seconds: np.ndarray, count: int, pick, sorted_ts) -> Dict[str, np.ndarray]:
        """Per-second mean capacitance, carried forward up to CAP_HOLD_SECONDS."""
        cap_ts = sorted_ts if sorted_ts is not None else _view(self._cap_ts, np.int64, count)
        first = int(np.searchsorted(cap_ts, seconds[0] - CAP_HOLD_SECONDS, side='left'))
        last = int(np.searchsorted(cap_ts, seconds[-1], side='right'))
        window = cap_ts[first:last]
        held = {}
        for side in SIDES:
            values = _view(self._cap[side], np.float32, count)
            values = values[first:last] if pick is None else values[pick[first:last]]
            held[side] = _hold(seconds, window, values)
        return held


def _view(values: array, dtype, count: int) -> np.ndarray:
    return np.frombuffer(values, dtype=dtype)[:count]


def _time_order(ts: np.ndarray, strict: bool) -> Optional[np.ndarray]:
    """Indices putting ts in time order, or None when it already is.

    With strict, a repeated second keeps only its first record.
    """
    if ts.size < 2 or (ts[1:] > ts[:-1] if strict else ts[1:] >= ts[:-1]).all():
        return None
    order = np.argsort(ts, kind='stable')
    if strict:
        # A repeated second is one record read twice, so the first stands.
        ordered = ts[order]
        keep = np.ones(ordered.size, dtype=bool)
        keep[1:] = ordered[1:] != ordered[:-1]
        order = order[keep]
    return order


def _hold(seconds: np.ndarray, cap_ts: np.ndarray, values: np.ndarray) -> np.ndarray:
    """Mean of each second's readings, carried forward up to CAP_HOLD_SECONDS."""
    held = np.full(seconds.size, np.nan)
    valid = ~np.isnan(values)
    cap_ts, values = cap_ts[valid], values[valid].astype(np.float64)
    if cap_ts.size == 0:
        return held
    cap_seconds, starts, counts = np.unique(cap_ts, return_index=True, return_counts=True)
    means = np.add.reduceat(values, starts) / counts
    position = np.searchsorted(cap_seconds, seconds, side='right') - 1
    found = position >= 0
    found[found] = seconds[found] - cap_seconds[position[found]] <= CAP_HOLD_SECONDS
    held[found] = means[position[found]]
    return held


def _optional(value: float) -> Optional[float]:
    return None if value != value else value
