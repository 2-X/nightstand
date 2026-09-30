"""Read and write the calibration store.

Every calibration write in this codebase goes through this module. Processing
code only reads, with one exception: the nightly analyzer reports the
occupied capacitance level it measured, through record_occupied_level. Two
modules each learning their own baseline at their own cadence, then
disagreeing about sensor health, is the failure this prevents.

The server reads these same tables through Prisma and never writes them.
"""
import json
import math
import time
from typing import List, Optional

from get_logger import get_logger

logger = get_logger()

# The empty-bed piezo floor is written here and read from the presence
# detectors, so the string travels between modules. A typo would write a
# second profile row under a sensor type no reader ever asks for, and the
# unique index would not catch it.
SENSOR_TYPE_PIEZO = 'piezo'
SENSOR_TYPE_CAP = 'cap'
# The capacitance rise a side shows while occupied, learned by the analyzer.
SENSOR_TYPE_CAP_OCCUPIED = 'cap_occupied'

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

# A night with less occupied time than this does not move the learned level.
OCCUPIED_MIN_SECONDS = 2 * 3600
# One night moves the learned level by at most this factor either way.
OCCUPIED_MAX_STEP = 1.25
# A full night of occupancy scores full quality.
OCCUPIED_FULL_SECONDS = 8 * 3600
# Two spans are the same night when their overlap covers at least this share
# of the shorter one. Consecutive nights whose windows touch stay apart.
SAME_NIGHT_OVERLAP = 0.5
# The whole-bed piezo gate uses the median of this many recent clean floors,
# which damps the night-to-night spread of a single measurement.
PIEZO_FLOOR_RUNS = 3
# Below this, a floor came from a thin window and is not used.
PIEZO_FLOOR_MIN_QUALITY = 0.1


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
    payload: Optional[dict] = None,
    source_start: Optional[int] = None,
    source_end: Optional[int] = None,
    conn=None,
) -> int:
    """Append one attempt. Called on every exit path, including skips.

    `payload` is what this run measured, and it is stored here as well as on
    the profile because calibration_profiles is upserted per
    (side, sensor_type) and therefore holds only the latest. Without it, a
    value's history lives nowhere but a rotating log file, which is how three
    weeks of empty-bed floors came to exist only as one number per night.
    """
    cursor = _connection(conn).execute(
        'INSERT INTO calibration_runs '
        '(side, sensor_type, status, trigger, started_at, duration_ms, quality, message, '
        'payload, source_start, source_end) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (side, sensor_type, status, trigger, started_at, duration_ms, quality, message,
         json.dumps(payload) if payload is not None else None, source_start, source_end),
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


def occupied_seconds(start_ts: int, end_ts: int, conn=None) -> list:
    """Seconds in [start_ts, end_ts] when EITHER side of the bed had vitals.

    Lives here rather than with the other vitals code because it exists only
    to validate a candidate calibration window: a baseline learned while the
    partner was in bed measures their movement coupling through the mattress
    frame, not an empty bed.

    Both sides on purpose. A window is only usable if nobody was in the bed at
    all, and the caller asks about one side at a time.

    The signal is one-directional and should be used that way. A vitals row
    proves somebody was there; the absence of one does not prove the bed was
    empty, since a row needs presence AND a readable signal. That makes this
    sound for rejecting contaminated windows and unsound for certifying clean
    ones, which is the job it has.
    """
    rows = _connection(conn).execute(
        'SELECT DISTINCT timestamp FROM vitals WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp',
        (start_ts, end_ts),
    ).fetchall()
    return [row[0] for row in rows]


def get_profile(side: str, sensor_type: str, conn=None) -> Optional[dict]:
    """The active profile, or None when nothing has been calibrated yet.

    Returning None rather than raising is deliberate: a fresh install, a
    first night, or a pod that has never seen an empty bed are normal states,
    not errors. Callers do not substitute a synthetic baseline for a missing
    one: the capacitive baseline's std is a z-score denominator, and a
    synthetic std would make every reading look like an enormous deviation
    and manufacture presence on an empty bed. The real caller
    (sleep_detector) skips capacitive presence for this side on None and
    falls back to the piezo signal alone.
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


def recent_piezo_floors(side: str, conn=None) -> List[float]:
    """The newest successful empty-bed piezo floors for this side, newest first."""
    rows = _connection(conn).execute(
        'SELECT payload FROM calibration_runs '
        'WHERE side = ? AND sensor_type = ? AND status = ? AND payload IS NOT NULL AND quality >= ? '
        'ORDER BY started_at DESC, id DESC LIMIT ?',
        (side, SENSOR_TYPE_PIEZO, STATUS_SUCCESS, PIEZO_FLOOR_MIN_QUALITY, PIEZO_FLOOR_RUNS),
    ).fetchall()
    floors = []
    for (payload,) in rows:
        try:
            floor = json.loads(payload).get('floor')
        except (ValueError, AttributeError):
            continue
        if isinstance(floor, (int, float)) and not isinstance(floor, bool):
            floors.append(float(floor))
    return floors


def load_presence_profiles(conn=None) -> dict:
    """Everything the capacitance presence detector learns from, for both sides."""
    profiles = {}
    for side in ('left', 'right'):
        cap = get_profile(side, SENSOR_TYPE_CAP, conn=conn)
        occupied = get_profile(side, SENSOR_TYPE_CAP_OCCUPIED, conn=conn)
        profiles[side] = {
            'cap': cap['payload'] if cap else None,
            'cap_occupied': occupied['payload'] if occupied else None,
            'piezo_floors': recent_piezo_floors(side, conn=conn),
        }
    return profiles


def record_occupied_level(
    side: str,
    level: float,
    seconds: int,
    source_start: int,
    source_end: int,
    conn=None,
) -> Optional[float]:
    """Store the capacitance rise a night showed while this side was occupied.

    source_start and source_end are the night's first entry and last exit.
    Returns the stored level, or None when the night was too short, the
    value unusable, or the night older than the stored one. The stored level
    moves at most OCCUPIED_MAX_STEP per night from the previous one, so one
    odd night (a guest, a heavy blanket) cannot swing the thresholds derived
    from it. A call whose span overlaps the stored profile's by at least
    SAME_NIGHT_OVERLAP of the shorter span is the same night analyzed again
    (a shorter window, a manual run): it steps from the level that stood
    before that night, so the level moves once per night, not once per run.
    The stored span grows to the union of that night's spans, so a later
    window over another part of the night is still recognized.
    """
    if seconds < OCCUPIED_MIN_SECONDS or not math.isfinite(level) or level <= 0:
        return None
    # The analyzer may pass numpy scalars; sqlite would store those as blobs.
    source_start, source_end = int(source_start), int(source_end)
    stored = float(level)
    previous = get_profile(side, SENSOR_TYPE_CAP_OCCUPIED, conn=conn)
    base = None
    night_start, night_end = source_start, source_end
    if previous:
        earlier = previous['payload'] if isinstance(previous['payload'], dict) else {}
        known_span = previous['source_start'] is not None and previous['source_end'] is not None
        same_night = known_span and _same_night(
            (previous['source_start'], previous['source_end']), (source_start, source_end))
        if known_span and not same_night and source_start < previous['source_start']:
            # An earlier night analyzed again; it already had its step.
            return None
        if same_night:
            base = earlier.get('before')
            night_start = min(night_start, previous['source_start'])
            night_end = max(night_end, previous['source_end'])
        else:
            base = earlier.get('level')
    if isinstance(base, (int, float)) and not isinstance(base, bool) and base > 0:
        stored = min(base * OCCUPIED_MAX_STEP, max(base / OCCUPIED_MAX_STEP, stored))
    else:
        base = None
    quality = min(1.0, seconds / OCCUPIED_FULL_SECONDS)
    payload = {'level': stored, 'measured': float(level), 'seconds': int(seconds), 'before': base}
    run_id = record_run(
        side, SENSOR_TYPE_CAP_OCCUPIED, STATUS_SUCCESS, TRIGGER_DAILY,
        started_at=int(time.time()), duration_ms=0, quality=quality, payload=payload,
        source_start=source_start, source_end=source_end, conn=conn,
    )
    save_profile(
        side, SENSOR_TYPE_CAP_OCCUPIED, payload, quality=quality,
        source_start=night_start, source_end=night_end, samples_used=int(seconds),
        run_id=run_id, conn=conn,
    )
    return stored


def _same_night(stored, span) -> bool:
    overlap = min(stored[1], span[1]) - max(stored[0], span[0])
    shorter = min(stored[1] - stored[0], span[1] - span[0])
    return overlap > 0 and overlap >= SAME_NIGHT_OVERLAP * shorter
