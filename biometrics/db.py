from datetime import datetime
from typing import List, Sequence, Tuple
import atexit
import json
import math
import numpy as np
import pandas as pd
import sqlite3

from data_types import *
from get_logger import *

logger = get_logger()

DB_FILE_PATH = f'{logger.folder_path}free-sleep.db'

# Create a persistent connection
conn = sqlite3.connect(DB_FILE_PATH, isolation_level=None, check_same_thread=False)
conn.execute("PRAGMA journal_mode=WAL;")  # Enable WAL mode
conn.execute("PRAGMA busy_timeout=5000;")  # Wait up to 5 seconds if locked
conn.execute("PRAGMA synchronous=NORMAL;")
conn.execute("PRAGMA foreign_keys=ON;")

def _checkpoint_and_close():
    try:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
    finally:
        conn.close()


atexit.register(_checkpoint_and_close)


def custom_serializer(obj):
    if isinstance(obj, (datetime, pd.Timestamp)):
        return obj.isoformat()  # Convert to ISO 8601 format
    raise TypeError(f"Type {type(obj)} not serializable")


def convert_timestamps(data: List[SleepRecord]) -> List[SleepRecord]:
    formatted_data = []
    for entry in data:
        formatted_entry: SleepRecord = {
            "side": entry["side"],
            "entered_bed_at": datetime.fromisoformat(entry["entered_bed_at"]),
            "left_bed_at": datetime.fromisoformat(entry["left_bed_at"]),
            "sleep_period_seconds": entry["sleep_period_seconds"],
            "times_exited_bed": entry["times_exited_bed"],
            "present_intervals": [
                (datetime.fromisoformat(start), datetime.fromisoformat(end))
                for start, end in entry["present_intervals"]
            ],
            "not_present_intervals": [
                (datetime.fromisoformat(start), datetime.fromisoformat(end))
                for start, end in entry["not_present_intervals"]
            ]
        }
        formatted_data.append(formatted_entry)
    return formatted_data


def insert_vitals(data: dict):
    """
    Inserts a record into the 'vitals' table. If a conflict occurs, it skips the insertion.
    """
    cursor = conn.cursor()

    sql = """
    INSERT INTO vitals (side, timestamp, heart_rate, hrv, breathing_rate)
    VALUES (:side, :timestamp, :heart_rate, :hrv, :breathing_rate)
    ON CONFLICT(side, timestamp) DO NOTHING;
    """
    if np.isnan(data['hrv']):
        data['hrv'] = 0
    else:
        data['hrv'] = math.floor(data['hrv'])

    if np.isnan(data['breathing_rate']):
        data['breathing_rate'] = 0
    else:
        data['breathing_rate'] = math.floor(data['breathing_rate'])

    data['heart_rate'] = math.floor(data['heart_rate'])
    logger.debug('Inserting vitals record...')
    try:
        cursor.execute(sql, data)
    except sqlite3.Error as error:
        logger.error(error)
    finally:
        cursor.close()


MAX_WINDOW_SECONDS = 25 * 3600
# Detection at a window's first seconds is not reliable, so a widened window
# keeps this much before a stored entry and after a stored exit.
WIDEN_MARGIN_SECONDS = 3600


def widen_window(side: str, window_start: int, window_end: int, max_seconds: int = MAX_WINDOW_SECONDS) -> Tuple[int, int]:
    """Grow a run's window to cover every stored same-side sleep record that
    overlaps it, plus WIDEN_MARGIN_SECONDS either side, so the run sees the
    whole night it may replace. The result always holds the original window
    and is never longer than max_seconds; an original window of max_seconds
    or more is returned as is, and a stored record that still does not fit is
    kept by the writer.
    """
    if window_end - window_start >= max_seconds:
        return window_start, window_end
    try:
        row = conn.execute(
            'SELECT MIN(entered_bed_at), MAX(left_bed_at) FROM sleep_records '
            'WHERE side = ? AND entered_bed_at < ? AND left_bed_at > ?;',
            (side, window_end, window_start),
        ).fetchone()
    except sqlite3.Error as error:
        logger.warning(f'Could not look up stored sleep records, keeping the window as given: {error}')
        return window_start, window_end
    if row is None or row[0] is None:
        return window_start, window_end
    wanted_start = min(window_start, row[0] - WIDEN_MARGIN_SECONDS)
    wanted_end = max(window_end, row[1] + WIDEN_MARGIN_SECONDS)
    start = min(window_start, max(wanted_start, wanted_end - max_seconds))
    return start, min(wanted_end, start + max_seconds)


def replace_analysis_results(
    side: str,
    sleep_records: List[SleepRecord],
    movement_rows: Sequence[Tuple[int, float]],
    window_start: int,
    window_end: int,
) -> Tuple[int, int]:
    """Write one analyzer run's sleep records and movement in one transaction.

    Stored same-side records that overlap a new record are replaced only when
    they lie entirely inside the run's window [window_start, window_end]. A
    stored record that reaches outside it is kept and the overlapping new
    record is skipped, because the run could not see the whole night. Each
    movement bin the run computed overwrites the stored one; bins it did not
    compute are left alone. A record for the other side raises ValueError
    before anything is written. On any other error the transaction is rolled
    back and the error raised, so the caller can report the run as failed.

    Returns (sleep records written, movement rows written).
    """
    for sleep_record in sleep_records:
        if sleep_record['side'] != side:
            raise ValueError(f"Sleep record for the {sleep_record['side']} side passed to the {side} side")
    logger.info(f'Writing {len(sleep_records)} sleep record(s) and {len(movement_rows)} movement row(s) '
                f'for the {side} side into {DB_FILE_PATH}...')
    if sleep_records:
        logger.info(json.dumps(sleep_records, indent=4, default=custom_serializer))

    select_overlapping = """
    SELECT id, entered_bed_at, left_bed_at FROM sleep_records
    WHERE side = ? AND entered_bed_at < ? AND left_bed_at > ?;
    """
    delete_record = 'DELETE FROM sleep_records WHERE id = ?;'
    insert_record = """
    INSERT OR REPLACE INTO sleep_records (
        side,
        entered_bed_at,
        left_bed_at,
        sleep_period_seconds,
        times_exited_bed,
        present_intervals,
        not_present_intervals
    ) VALUES (?, ?, ?, ?, ?, ?, ?);
    """
    insert_movement = 'INSERT OR REPLACE INTO movement (side, timestamp, total_movement) VALUES (?, ?, ?);'

    cursor = conn.cursor()
    try:
        cursor.execute('BEGIN IMMEDIATE;')
        replaced = 0
        written = 0
        for sleep_record in sleep_records:
            entered_bed_at = int(sleep_record['entered_bed_at'].timestamp())
            left_bed_at = int(sleep_record['left_bed_at'].timestamp())
            present_intervals_str = json.dumps([
                [int(start.timestamp()), int(end.timestamp())] for start, end in sleep_record.get('present_intervals', [])
            ])
            not_present_intervals_str = json.dumps([
                [int(start.timestamp()), int(end.timestamp())] for start, end in sleep_record.get('not_present_intervals', [])
            ])
            overlapping = cursor.execute(select_overlapping, (side, left_bed_at, entered_bed_at)).fetchall()
            if any(stored_start < window_start or stored_end > window_end for _, stored_start, stored_end in overlapping):
                continue
            for stored_id, _, _ in overlapping:
                cursor.execute(delete_record, (stored_id,))
            replaced += len(overlapping)
            written += 1
            cursor.execute(insert_record, (
                side,
                entered_bed_at,
                left_bed_at,
                sleep_record.get('sleep_period_seconds', 0),
                sleep_record.get('times_exited_bed', 0),
                present_intervals_str,
                not_present_intervals_str,
            ))
        if movement_rows:
            cursor.executemany(insert_movement, [
                (side, int(timestamp), float(total)) for timestamp, total in movement_rows
            ])
        cursor.execute('COMMIT;')
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise
    finally:
        cursor.close()
    logger.info(f'Wrote {written} sleep record(s), replacing {replaced} overlapping '
                f'({len(sleep_records) - written} kept as stored), and {len(movement_rows)} movement row(s).')
    return written, len(movement_rows)
