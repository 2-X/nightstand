"""When the pump ran at high speed, from frzHealth frames.

Kept apart from the newer vitals estimators so the stream can feed it with
those estimators never loaded.
"""
from __future__ import annotations

import math
from typing import Optional, Tuple

from service_health import frz_record_epoch

SIDES = ('left', 'right')
# Our frzHealth frames show about 1900 to 2000 rpm while circulating and
# about 3000 during the daily priming run.
PUMP_HIGH_RPM = 2500
# frzHealth frames come about every 10 s; the speed may change anywhere between two.
PUMP_FRAME_SECONDS = 10
PUMP_HISTORY_SECONDS = 900
# A fast run with no frame for this long is unknown, not fast.
PUMP_STALE_SECONDS = 30
# A frame this much older than the newest is a clock change, not a replay: the history starts over.
# The same size as the newer vitals' own limit.
CLOCK_STEP_BACK_SECONDS = 600


def _number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


class PumpSpeed:
    """Spans of time the pump ran at high speed, from frzHealth frames.

    note() runs on the reader thread and high_during() on the processing
    thread, so the state is replaced in one assignment, never edited.
    """

    def __init__(self):
        # ((start, end) spans with end None while the newest frame says high
        # speed, stamp of the newest frame with a reading).
        self._state: Tuple[Tuple[Tuple[float, Optional[float]], ...], Optional[float]] = ((), None)

    @property
    def fed(self) -> bool:
        return self._state[1] is not None

    def note(self, frame: dict) -> None:
        ts = frz_record_epoch(frame) if isinstance(frame, dict) else None
        spans, last_ts = self._state
        if ts is None or not math.isfinite(ts):
            return
        if last_ts is not None and ts < last_ts:
            if last_ts - ts <= CLOCK_STEP_BACK_SECONDS:
                return
            spans, last_ts = (), None
        rpms = [((frame.get(side) or {}).get('pump') or {}).get('rpm') for side in SIDES]
        rpms = [rpm for rpm in rpms if _number(rpm)]
        if not rpms:
            return
        spans = [span for span in spans if span[1] is None or span[1] >= ts - PUMP_HISTORY_SECONDS]
        running = bool(spans) and spans[-1][1] is None
        if running and ts - last_ts > PUMP_STALE_SECONDS:
            spans[-1] = (spans[-1][0], last_ts + PUMP_STALE_SECONDS)
            running = False
        if max(rpms) >= PUMP_HIGH_RPM:
            if not running:
                spans.append((ts - PUMP_FRAME_SECONDS, None))
        elif running:
            spans[-1] = (spans[-1][0], ts)
        self._state = (tuple(spans), ts)

    def high_during(self, start: float, end: float) -> bool:
        spans, last_ts = self._state
        return any(begin < end and (last_ts + PUMP_STALE_SECONDS if stop is None else stop) > start
                   for begin, stop in spans)
