"""
Analyze one side's sleep for a time window: load RAW sensor data, find time in
bed and movement, and write sleep_records and movement.

Usage (on the Pod the server runs this daily and from the Status page):
    /home/dac/venv/bin/python -B analyze_sleep.py --side=left --start_time=2026-09-28T19:00:00Z --end_time=2026-09-29T20:00:00Z

Off the Pod, set DATA_FOLDER to a folder holding free-sleep.db, lowdb/ and
raw-archive/.
"""

import sys
import os
from argparse import ArgumentParser, Namespace
from datetime import datetime, timezone

sys.path.append(os.getcwd())
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Live RAW files; the archive under the data folder is read as well.
FOLDER_PATH = '/persistent/'

from get_logger import get_logger
# This must run before the other local import in order to set up the logger
logger = get_logger('sleep-analyzer')

from db import replace_analysis_results, widen_window
from sleep_detector import detect_sleep, detect_movement
from resource_usage import get_memory_usage_unix, get_available_memory_mb
from biometrics_helpers import validate_datetime_utc
from service_health import update_health, is_biometrics_enabled
from insufficient_data import outcome_for_exception, NO_SLEEP_MESSAGE


def _parse_args() -> Namespace:
    parser = ArgumentParser(description="Process presence intervals with UTC datetime.")
    parser.add_argument(
        "--side",
        choices=["left", "right"],
        required=True,
        help="Side of the bed to process (left or right)."
    )
    parser.add_argument(
        "--start_time",
        type=validate_datetime_utc,
        required=True,
        help="Start time in UTC format 'YYYY-MM-DD HH:MM:SS'."
    )
    parser.add_argument(
        "--end_time",
        type=validate_datetime_utc,
        required=True,
        help="End time in UTC format 'YYYY-MM-DD HH:MM:SS'."
    )
    args = parser.parse_args()
    if args.start_time >= args.end_time:
        raise ValueError("--start_time must be earlier than --end_time")
    return args


if __name__ == "__main__":
    args = _parse_args()
    job_key = f'analyzeSleep{args.side.capitalize()}'
    try:
        if not is_biometrics_enabled():
            logger.info('Not analyzing sleep, biometrics is disabled')

        logger.debug(f"START Free Memory: {get_available_memory_mb()} MB")
        logger.debug(f"START Memory Usage: {get_memory_usage_unix():.2f} MB")

        update_health(job_key, 'started', '')

        if get_available_memory_mb() < 400:
            message = 'Available memory is too little, exiting...'
            update_health(job_key, 'failed', message)
            raise MemoryError(message)

        start_time, end_time = args.start_time, args.end_time
        window_start, window_end = int(start_time.timestamp()), int(end_time.timestamp())
        # Read the whole of any stored night this window overlaps, so the run
        # can replace it instead of leaving a truncated copy.
        wide_start, wide_end = widen_window(args.side, window_start, window_end)
        if (wide_start, wide_end) != (window_start, window_end):
            logger.info(f'Widening the window to {wide_start} -> {wide_end} to cover a stored night')
            window_start, window_end = wide_start, wide_end
            start_time = datetime.fromtimestamp(window_start, tz=timezone.utc)
            end_time = datetime.fromtimestamp(window_end, tz=timezone.utc)

        merged_df, sleep_records, cap_df = detect_sleep(
            args.side,
            start_time,
            end_time,
            FOLDER_PATH
        )
        del merged_df
        movement_rows = detect_movement(args.side, cap_df)
        del cap_df
        replace_analysis_results(args.side, sleep_records, movement_rows, window_start, window_end)
        # No sleep found is not an error, but say so instead of a silent green.
        update_health(job_key, 'healthy', '' if sleep_records else NO_SLEEP_MESSAGE)

        logger.debug(f"END Memory Usage: {get_memory_usage_unix():.2f} MB")
        logger.debug(f"END Free Memory: {get_available_memory_mb()} MB")
    except KeyboardInterrupt:
        logger.info('Keyboard interrupt signal received, exiting...')
        update_health(job_key, 'failed', 'Interrupted')
    except Exception as error:
        # No full night archived yet (fresh install) reports the calm
        # 'waiting_for_data' state instead of a failure; real errors stay
        # 'failed', logged with their traceback.
        status, message = outcome_for_exception(error)
        if status == 'failed':
            logger.error(error)
            logger.error('Error analyzing sleep, exiting...')
        else:
            logger.info(message)
        update_health(job_key, status, message)
