"""Record each sleep analyzer run in the analysis_runs table.

One row per attempt: the window it covered, how much sensor data it read,
what it wrote, how long it took, its peak memory and its outcome. The server
reads this table and never writes it.
"""
import json
import os
import time
from typing import Optional

KIND_ANALYZE = 'analyze'

STATUS_RUNNING = 'running'
STATUS_OK = 'ok'
STATUS_NO_DATA = 'no_data'
STATUS_FAILED = 'failed'

INTERRUPTED = 'Interrupted before it finished'

_FINISHED = (STATUS_OK, STATUS_NO_DATA, STATUS_FAILED)
_COUNTS = ('rows_loaded', 'records_written', 'movement_written', 'duration_ms', 'peak_rss_mb', 'error')
_SERVER_INFO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'server', 'src', 'serverInfo.json')


def _connection(conn=None):
    if conn is not None:
        return conn
    import db
    return db.conn


def code_version() -> Optional[str]:
    try:
        with open(_SERVER_INFO) as file:
            return json.load(file).get('version')
    except (OSError, ValueError):
        return None


def start_run(side: str, kind: str, window_start: int, window_end: int, conn=None) -> int:
    connection = _connection(conn)
    now = int(time.time())
    # The server runs one analysis per side at a time, so a run still marked
    # running when the next one starts was killed before it could say so.
    connection.execute(
        'UPDATE analysis_runs SET status = ?, finished_at = ?, error = ? WHERE side = ? AND kind = ? AND status = ?',
        (STATUS_FAILED, now, INTERRUPTED, side, kind, STATUS_RUNNING),
    )
    cursor = connection.execute(
        'INSERT INTO analysis_runs (side, kind, started_at, window_start, window_end, status, code_version) '
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
        (side, kind, now, window_start, window_end, STATUS_RUNNING, code_version()),
    )
    return cursor.lastrowid


def finish_run(run_id: int, status: str, conn=None, **counts) -> None:
    if status not in _FINISHED:
        raise ValueError(f'Unknown analysis run status: {status}')
    unknown = sorted(set(counts) - set(_COUNTS))
    if unknown:
        raise ValueError(f'Unknown analysis run fields: {unknown}')
    # A run closed as interrupted by a later start can still finish; its outcome replaces that error.
    counts = {'error': None, **counts}
    assignments = ['status = ?', 'finished_at = ?'] + [f'{name} = ?' for name in counts]
    values = [status, int(time.time())] + list(counts.values()) + [run_id]
    cursor = _connection(conn).execute(f'UPDATE analysis_runs SET {", ".join(assignments)} WHERE id = ?', values)
    if cursor.rowcount == 0:
        raise ValueError(f'No analysis run with id {run_id}')


def summarize(counts: dict) -> str:
    """One line for the Status page."""
    records = counts.get('records_written', 0)
    noun = 'record' if records == 1 else 'records'
    return (f'{records} sleep {noun} and {counts.get("movement_written", 0)} movement rows '
            f'from {counts.get("rows_loaded", 0):,} sensor rows')
