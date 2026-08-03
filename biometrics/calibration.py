"""Read and write the calibration store.

Every calibration write in this codebase goes through this module. Processing
code only reads. Two modules each learning their own baseline at their own
cadence, then disagreeing about sensor health, is the failure this prevents.

The server reads these same tables through Prisma and never writes them.
"""
import json
import time
from typing import Optional

from get_logger import get_logger

logger = get_logger()

STATUS_SUCCESS = 'success'
STATUS_FAILED = 'failed'
STATUS_INSUFFICIENT_DATA = 'insufficient_data'
STATUS_SKIPPED_OCCUPIED = 'skipped_occupied'

TRIGGER_DAILY = 'daily'
TRIGGER_MANUAL = 'manual'
TRIGGER_STARTUP = 'startup'
TRIGGER_MIGRATION = 'migration'

# A calibration window this long scores full marks. Shorter windows score
# proportionally less, floored by empty_minutes in the calibrator at 5 minutes.
TARGET_WINDOW_SECONDS = 1800

# What each sensor type falls back to when no profile exists. A fresh install,
# a first night, or a pod that has never seen an empty bed are normal states,
# not errors, so every reader must have somewhere to land. Keep this in step
# with the per-bed learned rows in docs/CALIBRATION.md.
DEFAULTS = {
    'cap': {
        'min_std': 1,
    },
}


def _connection(conn=None):
    if conn is not None:
        return conn
    import db
    return db.conn


def compute_quality(empty_window_seconds: float, samples_used: int, expected_samples: int) -> float:
    """Confidence in a profile, 0.0 to 1.0.

    Both terms are measured over the baseline window the calibrator selected,
    not over the much longer window of raw data it loaded to find it. Scoring
    against the load window would make every profile look poor.
    """
    if expected_samples <= 0:
        return 0.0
    window_score = min(1.0, empty_window_seconds / TARGET_WINDOW_SECONDS)
    density_score = min(1.0, samples_used / expected_samples)
    return window_score * density_score


def record_run(
    side: str,
    sensor_type: str,
    status: str,
    trigger: str,
    started_at: int,
    duration_ms: int,
    quality: Optional[float] = None,
    message: Optional[str] = None,
    conn=None,
) -> int:
    """Append one attempt. Called on every exit path, including skips."""
    cursor = _connection(conn).execute(
        'INSERT INTO calibration_runs '
        '(side, sensor_type, status, trigger, started_at, duration_ms, quality, message) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        (side, sensor_type, status, trigger, started_at, duration_ms, quality, message),
    )
    return cursor.lastrowid


def update_run(run_id: int, status: str, message: Optional[str] = None, conn=None) -> None:
    """Amend an existing run row rather than appending a new one.

    A single attempt must leave a single record. When a failure happens after
    the success row for that attempt has already been written (a late
    save_profile error, for instance), the honest fix is to correct that row
    in place, not to append a second, contradicting one for the same attempt.
    """
    _connection(conn).execute(
        'UPDATE calibration_runs SET status = ?, message = ? WHERE id = ?',
        (status, message, run_id),
    )


def save_profile(
    side: str,
    sensor_type: str,
    payload: dict,
    quality: float,
    source_start: int,
    source_end: int,
    samples_used: int,
    run_id: int,
    conn=None,
) -> None:
    """Replace the active profile for this side and sensor type.

    The unique index on (side, sensor_type) is what "exactly one active"
    means, so this upserts rather than appending. History lives in
    calibration_runs.
    """
    _connection(conn).execute(
        'INSERT INTO calibration_profiles '
        '(side, sensor_type, payload, quality, source_start, source_end, samples_used, run_id, created_at) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) '
        'ON CONFLICT (side, sensor_type) DO UPDATE SET '
        'payload=excluded.payload, quality=excluded.quality, '
        'source_start=excluded.source_start, source_end=excluded.source_end, '
        'samples_used=excluded.samples_used, run_id=excluded.run_id, '
        'created_at=excluded.created_at',
        (
            side, sensor_type, json.dumps(payload), quality,
            source_start, source_end, samples_used, run_id, int(time.time()),
        ),
    )


def get_profile(side: str, sensor_type: str, conn=None) -> Optional[dict]:
    """The active profile, or None when nothing has been calibrated yet.

    Returning None rather than raising is deliberate: callers fall back to
    DEFAULTS, because never having calibrated is a normal state.
    """
    row = _connection(conn).execute(
        'SELECT payload, quality, source_start, source_end, samples_used, created_at '
        'FROM calibration_profiles WHERE side = ? AND sensor_type = ?',
        (side, sensor_type),
    ).fetchone()
    if row is None:
        return None
    return {
        'payload': json.loads(row[0]),
        'quality': row[1],
        'source_start': row[2],
        'source_end': row[3],
        'samples_used': row[4],
        'created_at': row[5],
    }


def import_legacy_baseline(side: str, file_path: str, conn=None) -> bool:
    """Carry a pre-store baseline JSON file into the store, once.

    Quality is 0.0 because nothing measured it, and the run is tagged
    TRIGGER_MIGRATION so the UI can say "carried over, confidence unknown"
    rather than "measured and poor". Those are different claims.

    Returns True when an import happened.
    """
    import os

    if get_profile(side, 'cap', conn=conn) is not None:
        return False
    if not os.path.isfile(file_path):
        return False

    with open(file_path, 'r') as json_file:
        payload = json.load(json_file)

    now = int(time.time())
    run_id = record_run(
        side, 'cap', STATUS_SUCCESS, TRIGGER_MIGRATION,
        started_at=now, duration_ms=0, quality=0.0,
        message='Carried over from a baseline file that predates provenance tracking',
        conn=conn,
    )
    save_profile(
        side, 'cap', payload, quality=0.0,
        source_start=now, source_end=now, samples_used=0, run_id=run_id, conn=conn,
    )
    logger.info(f'Imported the legacy {side} baseline into the calibration store')
    return True
