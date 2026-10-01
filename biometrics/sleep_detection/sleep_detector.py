"""
This module detects sleep periods by analyzing presence intervals derived from piezoelectric
and capacitance sensor data.

Key functionalities:
- Loads and preprocesses raw sensor data.
- Detects presence using piezoelectric and capacitance sensors.
- Identifies sleep intervals by merging presence periods with small gaps.
- Filters valid sleep periods based on predefined thresholds.
- Returns sleep records and movement; analyze_sleep.py writes them.
"""

import pandas as pd
import numpy as np
import calendar
import gc
import sqlite3
import math
from typing import List, Optional, Tuple
from datetime import datetime, timedelta

from data_types import *
from sleep_detection.cap_data import load_cap_df, load_baseline, detect_presence_cap
from get_logger import get_logger
from load_raw_files import NO_CAP_READING, load_raw_files
from piezo_data import load_piezo_df, detect_presence_piezo_p2p
import calibration
from features import biometrics_v2_enabled
from presence.detector import DetectorParams
from presence.params import baselines_from_calibration, params_from_calibration
from presence.replay import FrameCollector, occupied_level, replay

logger = get_logger()

# Below this share of seconds with a capacitance reading, a night is read the
# way it was before capacitance presence (Pod 3 and 4 have no capSense2).
MIN_CAP_COVERAGE = 0.5

# (epoch seconds of a 2-minute bin start, largest per-second movement in it)
MovementRow = Tuple[int, float]
BIN_SECONDS = 120


def _get_presence_intervals(df: pd.DataFrame, side: Side, presence_duration_threshold_seconds=60) -> Tuple[
    List[Tuple[datetime, datetime]], List[Tuple[datetime, datetime]]]:
    """
    Get time intervals when someone was present and not present on the bed,
    requiring presence intervals to be at least 1 minute long.

    Parameters:
        df (pd.DataFrame): The input DataFrame with occupancy data.
        side (str): 'left' or 'right' to check occupancy.
        presence_duration_threshold_seconds (int): The minimum amount of time presence must be detected in order to add it

    Returns:
        present_intervals (list): List of tuples (start_time, end_time) when occupied (>= 1 min).
        not_present_intervals (list): List of tuples (start_time, end_time) when not occupied.
    """
    # Select the relevant column based on the chosen side
    occupancy_col = f'final_{side}_occupied'

    # Initialize tracking variables
    present_intervals = []
    not_present_intervals = []
    current_status = None
    start_time = df.index[0]

    # Iterate over DataFrame to find state changes
    for timestamp, row in df.iterrows():
        # Presence = EITHER piezo OR cap fires. Requiring both (== 2) loses
        # true occupancy: piezo misses still sleep (range below threshold
        # when only breathing), and cap on its own is not trustworthy enough
        # to require. (cap_data.py's
        # min_std floor was tuned for an older, larger-scale capSense
        # hardware and dominated Pod 5's much smaller capSense2 z-score
        # denominators, so cap presence fired on ~0% of confirmed-occupied
        # samples that night; fixed by lowering the floor to match this
        # hardware's measured noise scale -- see cap_data.py -- which
        # restored cap presence to ~90-99% of confirmed-occupied samples on
        # the same recording. Keeping the OR here rather than switching to
        # cap-only or AND, since piezo alone still misses still/breathing-
        # only occupancy and one night of data is not enough to trust
        # cap presence as a sole signal.) The 1-minute duration filter,
        # 15-min merge, and 3-hour sleep-period minimum downstream still
        # suppress short false positives.
        status = row[occupancy_col] >= 1

        if current_status is None:
            current_status = status
            continue

        # Check for status change
        if status != current_status:
            end_time = timestamp
            duration = end_time - start_time

            if current_status:
                # Only add presence intervals >= 1 minute
                if duration >= timedelta(minutes=1):
                    present_intervals.append((start_time, end_time))
            else:
                not_present_intervals.append((start_time, end_time))

            # Update for the new interval
            start_time = timestamp
            current_status = status

    # Capture the last interval
    end_time = df.index[-1]
    duration = end_time - start_time

    if current_status:
        if duration >= timedelta(seconds=presence_duration_threshold_seconds):
            present_intervals.append((start_time, end_time))
    else:
        not_present_intervals.append((start_time, end_time))

    return present_intervals, not_present_intervals


def _total_duration_seconds(intervals) -> int:
    """
    Given an array of (start_time, end_time) tuples, calculate the total duration.

    Args:
        intervals (list of tuples): List of (start_time, end_time) tuples.
    """
    total_time = sum((end - start for start, end in intervals), timedelta())
    return int(total_time.total_seconds())


def _identify_sleep_intervals(
    present_intervals: List[Tuple[datetime, datetime]],
    max_gap_in_minutes: int = 15,
    real_exit_min_minutes: int = 5,
):
    """
    Identifies sleep periods by merging intervals with small gaps.

    Args:
        present_intervals: List of (start_time, end_time) tuples representing presence periods.
        max_gap_in_minutes: Maximum gap between intervals before they're treated as
            separate sleep sessions. Defaults to 15.
        real_exit_min_minutes: Minimum gap (within a merged session) to count as an
            actual bed exit. Smaller gaps are treated as sensor blips (you rolled
            over, sensor briefly didn't register), not real exits. Defaults to 5.
            This dramatically reduces false "you woke up" events caused by
            sub-minute presence-detection dropouts.

    Returns:
        list of dicts: A list of detected sleep periods, each containing:
            - 'entered_bed_at': Start time of the sleep period.
            - 'left_bed_at': End time of the sleep period.
            - 'sleep_period_seconds': Total sleep duration.
            - 'times_exited_bed': Number of times the person exited the bed
              (only counts gaps >= real_exit_min_minutes).
    """
    logger.debug(
        f'Identifying sleep intervals... | max_gap_in_minutes={max_gap_in_minutes} '
        f'real_exit_min_minutes={real_exit_min_minutes}'
    )
    max_gap = timedelta(minutes=max_gap_in_minutes)
    real_exit_min = timedelta(minutes=real_exit_min_minutes)
    if not present_intervals:
        return []

    sleep_intervals = []
    current_start, current_end = present_intervals[0]  # Start with the first interval
    total_sleep_time = current_end - current_start
    exit_count = 0

    for ix in range(1, len(present_intervals)):
        next_start, next_end = present_intervals[ix]  # Get next interval
        gap = next_start - current_end  # Calculate gap between intervals

        if gap <= max_gap:
            # Merge into the current sleep period
            current_end = next_end
            total_sleep_time += (next_end - next_start)
            # Only count this as a real bed exit if the gap is non-trivial.
            # Tiny gaps are sensor blips (presence detection briefly lost
            # the user while they were still in bed), not actual exits.
            if gap >= real_exit_min:
                exit_count += 1
        else:
            # Only add sleep interval if it's greater than 3 hours
            if total_sleep_time > timedelta(hours=3):
                sleep_intervals.append({
                    'entered_bed_at': current_start,
                    'left_bed_at': current_end,
                    'sleep_period_seconds': int(total_sleep_time.total_seconds()),
                    'times_exited_bed': exit_count,
                })

            # Reset values for the new sleep period
            current_start, current_end = next_start, next_end
            total_sleep_time = current_end - current_start
            exit_count = 0

    # Ensure the last interval is added only if it meets the 3-hour requirement
    if total_sleep_time > timedelta(hours=3):
        sleep_intervals.append({
            'entered_bed_at': current_start,
            'left_bed_at': current_end,
            'sleep_period_seconds': int(total_sleep_time.total_seconds()),
            'times_exited_bed': exit_count,
        })

    return sleep_intervals


def _filter_intervals(
        intervals: List[Tuple[datetime, datetime]],
        start: datetime,
        end: datetime
) -> List[Tuple[datetime, datetime]]:
    """
    Filters intervals to include only those that overlap with the given start and end times.
    """
    filtered_intervals = [
        (max(interval_start, start), min(interval_end, end))
        for interval_start, interval_end in intervals
        if interval_end > start and interval_start < end  # Overlap condition
    ]
    return filtered_intervals


def build_sleep_records(merged_df: pd.DataFrame, side: Side, max_gap_in_minutes: int = 15) -> List[SleepRecord]:
    logger.debug('Building sleep records...')

    present_intervals, not_present_intervals = _get_presence_intervals(merged_df, side)
    sleep_intervals = _identify_sleep_intervals(present_intervals, max_gap_in_minutes=max_gap_in_minutes)

    sleep_records: List[SleepRecord] = []
    for sleep_interval in sleep_intervals:
        entered_bed_at = sleep_interval['entered_bed_at']
        left_bed_at = sleep_interval['left_bed_at']

        # Filter intervals specific to the current sleep interval
        filtered_present_intervals = _filter_intervals(present_intervals, entered_bed_at, left_bed_at)
        filtered_not_present_intervals = _filter_intervals(not_present_intervals, entered_bed_at, left_bed_at)

        sleep_records.append({
            "side": side,
            **sleep_interval,
            'present_intervals': filtered_present_intervals,
            'not_present_intervals': filtered_not_present_intervals,
        })

    return sleep_records


def _occupancy_from_intervals(index: pd.DatetimeIndex, intervals: List[Tuple[int, int]]) -> np.ndarray:
    """1 for each timestamp inside an occupied [start, end) interval of unix seconds, else 0."""
    seconds = index.values.astype('datetime64[s]').astype(np.int64)
    occupied = np.zeros(len(seconds), dtype=np.int64)
    if not intervals:
        return occupied
    starts = np.array([start for start, _ in intervals], dtype=np.int64)
    ends = np.array([end for _, end in intervals], dtype=np.int64)
    position = np.searchsorted(starts, seconds, side='right') - 1
    inside = position >= 0
    inside[inside] = seconds[inside] < ends[position[inside]]
    occupied[inside] = 1
    return occupied


def _presence_v2_setup(start_time: datetime, end_time: datetime) -> Tuple[Optional[FrameCollector], Optional[DetectorParams]]:
    """A frame collector and detector parameters when capacitance presence applies to this run."""
    if not biometrics_v2_enabled():
        return None, None
    try:
        profiles = calibration.load_presence_profiles(
            window=(int(start_time.timestamp()), int(end_time.timestamp())))
        params = params_from_calibration(profiles)
        baselines = baselines_from_calibration(profiles)
        if params is None or baselines is None:
            logger.warning('No capacitance baseline for both sides yet, reading the night as before')
            return None, None
        return FrameCollector(baselines), params
    except Exception as error:
        # The switch must never cost a night's analysis.
        logger.warning(f'Could not set up capacitance presence, reading the night as before: {error}')
        return None, None


def _replay_side(collector: Optional[FrameCollector], params: Optional[DetectorParams], side: Side) -> Optional[List[Tuple[int, int]]]:
    """This side's occupied intervals from the shared detector, or None to use the older rule."""
    if collector is None:
        return None
    cap_format = collector.cap_format()
    if cap_format is not None and not cap_format.validated:
        return None
    coverage = collector.cap_coverage()
    if coverage < MIN_CAP_COVERAGE:
        logger.warning(f'Capacitance covers {coverage:.0%} of the window, reading the {side} side as before')
        return None
    return replay(collector.frames(), params)[side]


def _epoch_seconds(moment: datetime) -> int:
    return calendar.timegm(moment.timetuple())


def _night_level(collector: FrameCollector, side: Side, sleep_records: List[SleepRecord]) -> Optional[Tuple[float, int, int, int]]:
    """(level, seconds, span start, span end) over the occupied intervals that make up the sleep records.

    Only those, so the same night gives the same level whichever window it was analyzed in.
    """
    intervals = sorted(
        (_epoch_seconds(start), _epoch_seconds(end))
        for record in sleep_records for start, end in record['present_intervals']
    )
    if not intervals:
        return None
    level, seconds = occupied_level(collector.frames(), intervals, side)
    logger.info(
        f'Capacitance presence for the {side} side: {len(intervals)} interval(s), '
        f'occupied level {level if level is None else round(level, 2)} over {seconds:,} s, '
        f'{collector.nbytes() / 1e6:.1f} MB of frames'
    )
    if level is None:
        return None
    return level, seconds, intervals[0][0], intervals[-1][1]


def _read_night_from_capacitance(merged_df: pd.DataFrame, side: Side, cap_baseline, collector: Optional[FrameCollector],
                                 params: Optional[DetectorParams]):
    """(sleep records, occupied level to store) from the shared detector, or None to use the older rule.

    Any failure is logged and leaves nothing behind, so the run reads the night as before.
    """
    try:
        intervals = _replay_side(collector, params, side)
        if intervals is None:
            return None
        _set_final_occupancy(merged_df, side, cap_baseline, occupied_intervals=intervals)
        sleep_records = build_sleep_records(merged_df, side, max_gap_in_minutes=15)
        return sleep_records, _night_level(collector, side, sleep_records)
    except Exception:
        logger.exception(f'Capacitance presence failed for the {side} side, reading the night as before')
        merged_df.drop(columns=[f'final_{side}_occupied'], errors='ignore', inplace=True)
        return None


def _set_final_occupancy(merged_df: pd.DataFrame, side: Side, cap_baseline,
                         occupied_intervals: Optional[List[Tuple[int, int]]] = None) -> pd.DataFrame:
    """Set final_{side}_occupied, from piezo alone when there is no cap baseline.

    Extracted from detect_sleep so the piezo-only fallback (cap_baseline is
    None) can be tested directly without the raw-file loading detect_sleep
    otherwise requires. occupied_intervals, when given, come from the shared
    capacitance detector and replace both older rules.
    """
    if occupied_intervals is not None:
        merged_df[f'final_{side}_occupied'] = _occupancy_from_intervals(merged_df.index, occupied_intervals)
    elif cap_baseline is None:
        # No calibrated baseline yet: fall back to piezo alone rather than
        # inventing a zero baseline, which would make every reading look
        # like an enormous deviation and manufacture presence in an empty bed.
        logger.warning(f'Skipping cap presence for {side} side: no baseline calibrated yet')
        merged_df[f'final_{side}_occupied'] = merged_df[f'piezo_{side}1_presence']
    else:
        detect_presence_cap(
            merged_df,
            cap_baseline,
            side,
            occupancy_threshold=5,
            rolling_seconds=10,
            threshold_percent=0.90,
            clean=False
        )

        merged_df[f'final_{side}_occupied'] = merged_df[f'piezo_{side}1_presence'] + merged_df[f'cap_{side}_occupied']
    return merged_df


def detect_sleep(side: Side, start_time: datetime, end_time: datetime, folder_path: str) -> Tuple[pd.DataFrame, List[SleepRecord], pd.DataFrame]:
    """Returns the merged frame, the sleep records and the capacitance frame
    as loaded. Movement reads the capacitance frame: the merged frame lacks the
    seconds the piezo trim dropped, and those differ from window to window."""
    expected_row_count = int((end_time - start_time).total_seconds())
    logger.info(f"Detecting sleep interval for {side} side | {start_time.isoformat()} -> {end_time.isoformat()} | Expected row count: {expected_row_count:,}")

    collector, presence_params = _presence_v2_setup(start_time, end_time)
    data = load_raw_files(folder_path, start_time, end_time, side, sensor_count=1, raw_data_types=['capSense', 'piezo-dual'],
                          presence_collector=collector)

    piezo_df = load_piezo_df(data, side, expected_row_count=expected_row_count, with_p2p=True)
    cap_df = load_cap_df(data, side, expected_row_count=expected_row_count, with_no_reading=True)
    # Cleanup data
    del data
    gc.collect()

    detect_presence_piezo_p2p(
        piezo_df,
        side,
        rolling_seconds=10,
        threshold_percent=0.70,
        noise_threshold=150_000,
        clean=True
    )

    merged_df = piezo_df.merge(cap_df.drop(columns=[f'{side}_no_reading']), on='ts', how='inner')
    merged_df.drop_duplicates(inplace=True)

    # Free up memory from old dfs
    piezo_df.drop(piezo_df.index, inplace=True)
    del piezo_df
    gc.collect()

    cap_baseline = load_baseline(side)
    from_capacitance = _read_night_from_capacitance(merged_df, side, cap_baseline, collector, presence_params)
    if from_capacitance is None:
        _set_final_occupancy(merged_df, side, cap_baseline)
        sleep_records = build_sleep_records(merged_df, side, max_gap_in_minutes=15)
    else:
        sleep_records, learned = from_capacitance
        if learned is not None:
            try:
                # The span of the night itself, so the same night analyzed over another window is recognized.
                calibration.record_occupied_level(side, *learned)
            except sqlite3.Error as error:
                logger.warning(f'Could not store the {side} occupied capacitance level: {error}')
    if len(sleep_records) == 0:
        logger.warning(f'No sleep periods found for {side} side! {start_time} -> {end_time} ')
    return merged_df, sleep_records, cap_df


def _one_row_per_second(frame: pd.DataFrame) -> pd.DataFrame:
    """First row of each second in load order. Capacitance arrives about twice
    a second, and an unstable sort used to keep either row."""
    ordered = frame.sort_values('ts', kind='stable')
    return ordered.drop_duplicates(subset=['ts'], keep='first')


def detect_movement(side: Side, cap_df: pd.DataFrame) -> List[MovementRow]:
    """Largest per-second sum of absolute capacitance changes in each 2-minute bin.

    Takes the capacitance frame from detect_sleep, so a bin's value does not
    depend on the window it was loaded in. A bin is returned only when all its
    seconds, and the second before the first (a change needs one), lie inside
    the loaded data. The bin at either edge of a window is therefore left out.
    Rows with a missing value ({side}_no_reading, or -1 on every channel) are
    skipped, and bins without a finite value are left out.
    """
    logger.debug('Computing movement...')
    columns = [f'{side}_out', f'{side}_cen', f'{side}_in']
    frame = cap_df.reset_index()
    skip = (frame[columns] == NO_CAP_READING).all(axis=1)
    if f'{side}_no_reading' in frame:
        skip |= frame[f'{side}_no_reading']
    frame = _one_row_per_second(frame[~skip])
    if frame.empty:
        return []

    movement_df = frame[columns].diff().abs()
    movement_df['total_movement'] = movement_df.sum(axis=1)
    movement_df['timestamp'] = frame['ts']
    movement_df.set_index('timestamp', inplace=True)
    resampled = movement_df.resample('2min').max().dropna()

    epoch_zero, one_second = pd.Timestamp('1970-01-01'), pd.Timedelta(seconds=1)
    epochs = (resampled.index - epoch_zero) // one_second
    first = int((frame['ts'].iloc[0] - epoch_zero) // one_second)
    last = int((frame['ts'].iloc[-1] - epoch_zero) // one_second)
    rows = [
        (int(epoch), float(total)) for epoch, total in zip(epochs, resampled['total_movement'])
        if epoch > first and epoch + BIN_SECONDS - 1 <= last and math.isfinite(total)
    ]

    movement_df.drop(movement_df.index, inplace=True)
    del movement_df, frame, resampled
    cap_df.drop(cap_df.index, inplace=True)
    gc.collect()
    return rows
