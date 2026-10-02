"""Per-minute vitals rows from the live piezo buffer with the v2 estimators.

Heart rate runs once a minute on a batch of the buffer through a tracker per
side, and a minute's row is written once all of its heart-rate windows are
final, about 40 seconds after the minute ends. Estimator state is kept per
side across short presence exits and resets after ABSENCE_RESET_SECONDS
without presence. The sample rate and the seconds each record covers come
from the piezo layout the stream read from the records, and signal is read
only from the records since the last gap in their stamps.

Capacitance presence alone decides which side an estimate belongs to: a
window counts only when its side was occupied, by a capacitance reading at
most CAP_MAX_AGE_SECONDS old, at the window's end. Windows that overlap the
pump running at high speed are dropped on both sides.
"""
from __future__ import annotations

import math
from collections import deque
from typing import Deque, Dict, List, Optional, Set, Tuple

from get_logger import get_logger
from presence.piezo import PiezoLayout
from pump_speed import PUMP_HIGH_RPM, PUMP_STALE_SECONDS, PumpSpeed  # noqa: F401  (re-exported)
from vitals2 import hr, hrv, resp
from vitals2.artifacts import mask_artifacts
from vitals2.attribution import attribute
from vitals2.rows import HrvEstimate, WindowEstimate, minute_row

logger = get_logger()

SIDES = ('left', 'right')
ABSENCE_RESET_SECONDS = 600
# The heart-rate batch runs this many seconds into each minute: the earliest
# point at which every window of the minute before is final.
BATCH_PHASE_SECONDS = hr.REPORT_DELAY_SECONDS - hr.HOP_SECONDS
# One hop of slack over what a batch needs, for records that are not one second long.
HR_BATCH_SECONDS = hr.BUFFER_SECONDS + hr.HOP_SECONDS
HR_MIN_SECONDS = hr.WINDOW_SECONDS + 2 * hr.EDGE_SECONDS
RESP_SECONDS = resp.WINDOW_SECONDS + 2 * resp.EDGE_SECONDS
# A breathing estimate describes the middle of its window, this long before it runs.
RESP_LAG_SECONDS = resp.EDGE_SECONDS + resp.WINDOW_SECONDS // 2
# Breathing windows with more bad samples than this are movement, not breathing.
RESP_MAX_BAD_FRACTION = 0.01
# Template learning needs a nearly clean minute.
LEARN_MAX_BAD_FRACTION = 0.01
# Oldest capacitance reading that may still place a window on a side.
CAP_MAX_AGE_SECONDS = 10
# Consecutive records further apart than this many record lengths have a gap between them.
MAX_RECORD_STEP = 1.5
# A step back of the record clock longer than this is a clock change: the estimators start over,
# as the tracker does after a gap this long.
CLOCK_STEP_BACK_SECONDS = hr.RESET_GAP_SECONDS
# Records of presence kept per side, enough to judge any window still waiting.
STATUS_RECORDS = 600
# Frames arrive about every 10 s, so a stream this old with none has no pump feed.
PUMP_UNFED_GRACE_SECONDS = 120


def _minute(seconds: float) -> int:
    return int(seconds // 60 * 60)


def _finite(value: Optional[float]) -> Optional[float]:
    return None if value is None or not math.isfinite(value) else float(value)


def _number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


class _SideState:
    def __init__(self):
        self.tracker = hr.HrTracker()
        self.hr_windows: Dict[int, List[WindowEstimate]] = {}
        self.resp_windows: Dict[int, List[WindowEstimate]] = {}
        self.present_minutes: Set[int] = set()
        self.template: Optional[hrv.BeatTemplate] = None
        self.last_present: Optional[int] = None
        # (record epoch, occupied with a current capacitance reading), oldest first.
        self.status: Deque[Tuple[int, bool]] = deque(maxlen=STATUS_RECORDS)

    def active(self, epoch: int) -> bool:
        return self.last_present is not None and epoch - self.last_present <= ABSENCE_RESET_SECONDS

    def occupied_at(self, moment: float, record_seconds: float) -> bool:
        """Whether the record covering the instant before `moment` placed this side in bed; False if unknown."""
        for epoch, occupied in reversed(self.status):
            if epoch < moment:
                return occupied and moment - epoch <= record_seconds
        return False


def _contiguous_records(buffer, record_seconds: float) -> int:
    """How many of the newest records follow one another with no gap, by their stamps.

    A gap is a step forward of more than MAX_RECORD_STEP records past every
    earlier stamp; a repeated or earlier stamp is a late record, not a gap.
    """
    count, newest = 0, None
    for record in buffer.piezo_buffer:
        ts = record.get('ts')
        if not _number(ts):
            count, newest = 0, None
            continue
        if newest is not None and ts - newest > MAX_RECORD_STEP * record_seconds:
            count = 0
        count += 1
        newest = ts if newest is None else max(newest, ts)
    return count


class _Clock:
    """Record counts for window lengths, from the layout's seconds per record."""

    def __init__(self, layout: PiezoLayout):
        self.fs = float(layout.freq)
        self.record_seconds = layout.record_seconds() or 1.0

    def records(self, seconds: float) -> int:
        return int(math.ceil(seconds / self.record_seconds))

    def seconds(self, records: int) -> float:
        return records * self.record_seconds


class Vitals2Stream:
    def __init__(self, pump: Optional[PumpSpeed] = None):
        self.sides = {side: _SideState() for side in SIDES}
        self.pump = pump if pump is not None else PumpSpeed()
        self.minute: Optional[int] = None
        self.last_batch: Optional[int] = None
        self.last_resp: Optional[int] = None
        self._warned_no_cap = False
        self._warned_no_pump = False
        self.first_epoch: Optional[int] = None
        self.last_epoch: Optional[int] = None

    def reset_side(self, side: str) -> None:
        self.sides[side] = _SideState()

    def step(self, epoch: int, layout: Optional[PiezoLayout], buffer, present: Dict[str, bool],
             cap_age: Optional[float] = None) -> List[dict]:
        """Advance one record; return the rows for any minute whose estimates are now final.

        `present` is each side's capacitance presence and `cap_age` the
        seconds between this record and the capacitance reading behind it,
        None without one. A side counts as in bed only while both hold.
        Without a layout that carries a sample rate only presence is tracked.
        """
        if self.first_epoch is None:
            self.first_epoch = epoch
        current = cap_age is not None and abs(cap_age) <= CAP_MAX_AGE_SECONDS
        if not current and any(present.get(side) for side in SIDES) and not self._warned_no_cap:
            self._warned_no_cap = True
            logger.warning('Newer vitals write nothing while no capacitance reading from the last '
                           f'{CAP_MAX_AGE_SECONDS} s places a side in bed')
        occupied = {side: bool(present.get(side)) and current for side in SIDES}
        minute = _minute(epoch)
        retired = self._clock_stepped_back(epoch, layout)
        expired = [side for side in SIDES if not occupied[side] and self.sides[side].last_present is not None
                   and not self.sides[side].active(epoch)]
        retired += self._retire(expired, epoch, layout) if expired else []
        for side in SIDES:
            state = self.sides[side]
            if side in expired:
                self.sides[side] = state = _SideState()
            elif occupied[side]:
                state.last_present = epoch
            state.status.append((epoch, occupied[side]))
        self.last_epoch = epoch
        if self.minute is not None and minute != self.minute:
            # A minute's row is kept only for a side present when the minute closed.
            for side in SIDES:
                if occupied[side]:
                    self.sides[side].present_minutes.add(self.minute)
        self.minute = minute
        if layout is None or layout.freq is None:
            return retired
        batch = (epoch - BATCH_PHASE_SECONDS) // 60
        heart_due = batch != self.last_batch
        breathing_due = self.last_resp is None or epoch - self.last_resp >= resp.HOP_SECONDS
        if not (heart_due or breathing_due):
            return retired
        clock = _Clock(layout)
        # Only the records since the last gap are signal; nothing is read across one.
        contiguous = _contiguous_records(buffer, clock.record_seconds)
        available = clock.seconds(contiguous)
        rows: List[dict] = []
        if available >= HR_MIN_SECONDS and heart_due:
            self.last_batch = batch
            rows = self._heart(epoch, clock, buffer, contiguous)
        if available >= RESP_SECONDS and breathing_due:
            self.last_resp = epoch
            self._breathing(epoch, clock, buffer)
        return retired + rows

    def _clock_stepped_back(self, epoch: int, layout: Optional[PiezoLayout]) -> List[dict]:
        """After a long step back of the clock, the rows still held, and every side and schedule started over.

        Without this, each tracker would wait for the clock to pass its last
        window and the absence reset would never fire.
        """
        if self.last_epoch is None or self.last_epoch - epoch <= CLOCK_STEP_BACK_SECONDS:
            return []
        logger.info(f'Record clock stepped back {self.last_epoch - epoch} s, newer vitals start over')
        rows = self._retire(list(SIDES), self.last_epoch + 1, layout)
        self.sides = {side: _SideState() for side in SIDES}
        self.minute = self.last_batch = self.last_resp = None
        self.first_epoch = epoch
        return rows

    def flush(self, epoch: int, layout: Optional[PiezoLayout]) -> List[dict]:
        """Rows for every minute before `epoch`'s that the estimators still hold, for a stream about to stop."""
        return self._retire(list(SIDES), epoch, layout)

    def _retire(self, sides: List[str], epoch: int, layout: Optional[PiezoLayout]) -> List[dict]:
        """Rows still owed by sides about to start over, from the windows their trackers hold back."""
        if layout is None or layout.freq is None:
            return []
        clock = _Clock(layout)
        self._judge({side: {window.start: window for window in self.sides[side].tracker.flush()} for side in sides},
                    clock)
        rows = []
        for side in sides:
            # Every window is in, so every minute closes; no HRV, the buffer no longer holds this signal.
            rows += self._close_minutes(side, epoch, clock, None, 0.0, epoch, epoch)
        return sorted(rows, key=lambda row: (row['timestamp'], SIDES.index(row['side'])))

    def _heart(self, epoch: int, clock: _Clock, buffer, contiguous: int) -> List[dict]:
        end = epoch + clock.record_seconds
        available = clock.seconds(contiguous)
        count = min(contiguous, clock.records(HR_BATCH_SECONDS))
        windows: Dict[str, Dict[int, hr.HrWindow]] = {}
        for side in SIDES:
            if self.sides[side].active(epoch):
                cleaned, bad = mask_artifacts(buffer.get_signal(side, count))
                windows[side] = {window.start: window for window in
                                 self.sides[side].tracker.step(cleaned, clock.fs, end, bad)}
        if (windows and not self.pump.fed and not self._warned_no_pump
                and epoch - self.first_epoch >= PUMP_UNFED_GRACE_SECONDS):
            self._warned_no_pump = True
            logger.warning('Newer vitals have no pump speed to check, so windows during a fast pump are kept')
        self._judge(windows, clock)
        rows = []
        for side in windows:
            rows += self._close_minutes(side, epoch, clock, buffer, available, end, self.sides[side].tracker.pending_from())
        return sorted(rows, key=lambda row: (row['timestamp'], SIDES.index(row['side'])))

    def _judge(self, windows: Dict[str, Dict[int, hr.HrWindow]], clock: _Clock) -> None:
        """File each side's new windows under their minute, usable only where they belong to that side."""
        for side, found in windows.items():
            state = self.sides[side]
            other_side = 'right' if side == 'left' else 'left'
            other = windows.get(other_side, {})
            for start, window in found.items():
                window_end = start + hr.WINDOW_SECONDS
                keep = (state.occupied_at(window_end, clock.record_seconds)
                        and not self.pump.high_during(start, window_end))
                # Attribution only settles a heart both occupied sides hear.
                if keep and start in other and self.sides[other_side].occupied_at(window_end, clock.record_seconds):
                    pair = attribute(window, other[start]) if side == 'left' else attribute(other[start], window)
                    keep = pair[0] if side == 'left' else pair[1]
                estimate = WindowEstimate(start, _finite(window.bpm), _finite(window.quality) or 0.0, usable=keep)
                state.hr_windows.setdefault(_minute(start), []).append(estimate)

    def _close_minutes(self, side: str, epoch: int, clock: _Clock, buffer, available: float, end: float,
                       final_before: Optional[int]) -> List[dict]:
        state = self.sides[side]
        if final_before is None:
            return []
        rows = []
        half = resp.WINDOW_SECONDS / 2
        for minute in sorted(m for m in state.hr_windows if m + 60 <= final_before):
            windows = state.hr_windows.pop(minute)
            breaths = [breath for breath in state.resp_windows.pop(minute, [])
                       if not self.pump.high_during(breath.timestamp - half, breath.timestamp + half)]
            row = minute_row(side, minute, windows, breaths, None)
            if row is None:
                continue
            variability = self._variability(epoch, clock, buffer, side, available, end, minute, row['heart_rate'])
            if variability is not None:
                row = minute_row(side, minute, windows, breaths, variability)
            if minute in state.present_minutes:
                rows.append(row)
        state.present_minutes = {m for m in state.present_minutes if m > final_before - 125}
        state.resp_windows = {m: w for m, w in state.resp_windows.items() if m > final_before - 125}
        return rows

    def _breathing(self, epoch: int, clock: _Clock, buffer) -> None:
        for side in SIDES:
            state = self.sides[side]
            if not state.active(epoch):
                continue
            centre = epoch - RESP_LAG_SECONDS
            if not state.occupied_at(centre + resp.WINDOW_SECONDS / 2, clock.record_seconds):
                continue
            cleaned, bad = mask_artifacts(buffer.get_signal(side, clock.records(RESP_SECONDS)))
            if hr.central(bad, clock.fs, resp.WINDOW_SECONDS).mean() > RESP_MAX_BAD_FRACTION:
                continue
            rate, quality = resp.estimate_resp(cleaned, clock.fs)
            state.resp_windows.setdefault(_minute(centre), []).append(
                WindowEstimate(centre, _finite(rate), _finite(quality) or 0.0))

    def _variability(self, epoch: int, clock: _Clock, buffer, side: str, available: float, end: float,
                     minute: int, bpm: float) -> Optional[HrvEstimate]:
        """Five-minute HRV for a minute the tracker reported, seeded with that minute's rate."""
        state = self.sides[side]
        if available < hrv.WINDOW_SECONDS or not state.occupied_at(end, clock.record_seconds):
            return None
        if self.pump.high_during(end - hrv.WINDOW_SECONDS, end):
            return None
        cleaned, bad = mask_artifacts(buffer.get_signal(side, clock.records(hrv.WINDOW_SECONDS)))
        if state.template is None or state.template.is_stale(epoch):
            stop = cleaned.size - int(round((end - minute - 60) * clock.fs))
            start = stop - int(hrv.LEARN_SECONDS * clock.fs)
            if start >= 0 and bad[start:stop].mean() <= LEARN_MAX_BAD_FRACTION:
                learned = hrv.BeatTemplate.learn(cleaned[start:stop], clock.fs, 60.0 / bpm, epoch)
                if learned is not None:
                    state.template = learned
        if state.template is None:
            return None
        rmssd, sdnn, coverage = hrv.rmssd_sdnn(hrv.jj_intervals(cleaned, clock.fs, state.template, bad=bad),
                                               hrv.WINDOW_SECONDS)
        coverage = _finite(coverage)
        if coverage is None:
            return None
        return HrvEstimate(epoch, _finite(rmssd), _finite(sdnn), coverage)
