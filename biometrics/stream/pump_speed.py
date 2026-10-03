"""How fast the pump ran, from frzHealth frames.

Kept apart from the newer vitals estimators so the stream can feed it with
those estimators never loaded.
"""
from __future__ import annotations

import math
from typing import Tuple

from service_health import frz_record_epoch

SIDES = ('left', 'right')
# Our frzHealth frames show about 1900 to 2000 rpm while circulating and
# about 3000 during the daily priming run.
PUMP_HIGH_RPM = 2500
PUMP_HISTORY_SECONDS = 900
# frzHealth frames come about every 10 s. A frame says the speed for this
# long after it; past that the speed is unknown.
PUMP_STALE_SECONDS = 30
# A frame this much older than the newest is a clock change, not a replay: the history starts over.
# The same size as the newer vitals' own limit.
CLOCK_STEP_BACK_SECONDS = 600
SLOW, FAST, UNKNOWN = 'slow', 'fast', 'unknown'


def _number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


class PumpSpeed:
    """The pump's speed over time, from frzHealth frames: slow, fast, or unknown.

    note() runs on the reader thread and speed_during() on the processing
    thread, so the frames are replaced in one assignment, never edited.
    """

    def __init__(self):
        # (stamp, fast) of each frame with a reading, oldest first.
        self._frames: Tuple[Tuple[float, bool], ...] = ()

    @property
    def fed(self) -> bool:
        return bool(self._frames)

    def note(self, frame: dict) -> None:
        ts = frz_record_epoch(frame) if isinstance(frame, dict) else None
        frames = self._frames
        if ts is None or not math.isfinite(ts):
            return
        if frames and ts < frames[-1][0]:
            if frames[-1][0] - ts <= CLOCK_STEP_BACK_SECONDS:
                return
            frames = ()
        rpms = [((frame.get(side) or {}).get('pump') or {}).get('rpm') for side in SIDES]
        rpms = [rpm for rpm in rpms if _number(rpm)]
        if not rpms:
            return
        kept = tuple(item for item in frames if item[0] >= ts - PUMP_HISTORY_SECONDS)
        self._frames = kept + ((ts, max(rpms) >= PUMP_HIGH_RPM),)

    def speed_during(self, start: float, end: float) -> str:
        """FAST if the pump may have run fast in (start, end), SLOW if frames show it slow throughout, else UNKNOWN.

        The speed may change anywhere between two frames, so the time between
        them is fast if either frame is. A frame holds for PUMP_STALE_SECONDS;
        before the first frame and after one goes stale nothing is known.
        """
        frames = self._frames
        if not frames:
            return UNKNOWN
        unknown = start < frames[0][0]
        for (ts, fast), (following, next_fast) in zip(frames, frames[1:]):
            if ts < end and following > start:
                if fast or next_fast:
                    return FAST
                unknown |= following - ts > PUMP_STALE_SECONDS and min(following, end) > ts + PUMP_STALE_SECONDS
        newest, fast = frames[-1]
        if fast and newest < end and start < newest + PUMP_STALE_SECONDS:
            return FAST
        return UNKNOWN if unknown or end > newest + PUMP_STALE_SECONDS else SLOW
