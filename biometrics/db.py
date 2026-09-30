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


def insert_sleep_records(sleep_records: List[SleepRecord]):
    """
    Inserts a list of records into the sleep_records table in the given database.
    Each record is expected to have:
      - side (str)
      - entered_bed_at (datetime)
      - left_bed_at (datetime, optional)
      - sleep_period_seconds (int)
      - times_exited_bed (int)
      - present_intervals (list of [start, end] datetime pairs)
      - not_present_intervals (list of [start, end] datetime pairs)

    Existing records on the same side that overlap a new record are replaced,
    so re-analyzing a night with a different window does not leave a second,
    overlapping record behind. All changes commit together or not at all.
    """
    if len(sleep_records) == 0:
        logger.warning(f'No sleep records to insert, exiting...')
        return
    logger.info(f'Inserting {len(sleep_records)} sleep record(s) into {DB_FILE_PATH}...')
    logger.info(json.dumps(sleep_records, indent=4, default=custom_serializer))

    delete_query = """
    DELETE FROM sleep_records
    WHERE side = ? AND entered_bed_at < ? AND left_bed_at > ?;
    """
    insert_query = """
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

    cursor = conn.cursor()
    try:
        cursor.execute('BEGIN IMMEDIATE;')
        replaced = 0
        for sleep_record in sleep_records:
            side = sleep_record['side']
            entered_bed_at = int(sleep_record['entered_bed_at'].timestamp())
            left_bed_at = int(sleep_record.get('left_bed_at').timestamp())

            # Encode intervals as JSON strings
            present_intervals_str = json.dumps([
                [int(start.timestamp()), int(end.timestamp())] for start, end in sleep_record.get('present_intervals', [])
            ])
            not_present_intervals_str = json.dumps([
                [int(start.timestamp()), int(end.timestamp())] for start, end in sleep_record.get('not_present_intervals', [])
            ])

            cursor.execute(delete_query, (side, left_bed_at, entered_bed_at))
            replaced += cursor.rowcount
            cursor.execute(insert_query, (
                side,
                entered_bed_at,
                left_bed_at,
                sleep_record.get('sleep_period_seconds', 0),
                sleep_record.get('times_exited_bed', 0),
                present_intervals_str,
                not_present_intervals_str,
            ))
        cursor.execute('COMMIT;')
        logger.info(f"Inserted {len(sleep_records)} record(s) into 'sleep_records', replacing {replaced} overlapping.")
    except Exception as error:
        if conn.in_transaction:
            conn.rollback()
        logger.error(error)
    finally:
        cursor.close()



def insert_movement_df(movement_df: pd.DataFrame):
    try:
        logger.debug(f'Inserting {movement_df.shape[0]} rows into movement table...')
        movement_df['timestamp'] = pd.to_datetime(movement_df['timestamp']).astype(int) // 10 ** 9

        # Use INSERT OR IGNORE on the (side, timestamp) UNIQUE index so that
        # re-running analyze on a day already in the DB silently skips
        # duplicates instead of bombing out with a UNIQUE constraint error
        # spam in the logs. Pandas' to_sql(..., if_exists='append') has no
        # native "ignore conflicts" option, so we go through executemany.
        cursor = conn.cursor()
        try:
            rows = list(movement_df[['side', 'timestamp', 'total_movement']].itertuples(index=False, name=None))
            cursor.executemany(
                'INSERT OR IGNORE INTO movement (side, timestamp, total_movement) VALUES (?, ?, ?)',
                rows,
            )
            inserted = cursor.rowcount
            conn.commit()
            logger.debug(f'Finished inserting movement rows: {inserted} new, {len(rows) - inserted} duplicates skipped')
        finally:
            cursor.close()

    except Exception as error:
        logger.error('Failed to insert movement df!')
        logger.error(error)


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
