import sys
import platform
import os
from datetime import datetime, timezone
import time
import math
from adaptive_circulation import report_circulation

sys.path.append(os.getcwd())
if platform.system().lower() == 'linux':
    sys.path.append('/home/dac/free-sleep/biometrics/')

# This must run before the other local import in order to set up the logger
from get_logger import get_logger

logger = get_logger()

import urllib.request
import json

# Throttle sensor temp updates to avoid flooding the server
_last_sensor_temps_update: float = 0
SENSOR_TEMPS_UPDATE_INTERVAL = 30  # seconds
# Both ingest paths can hand update_sensor_temps() records far older than
# "now": the RAW-file fallback replays the current file from byte 0 on
# startup, and the durable NATS consumer replays its acked backlog after a
# restart. Posting those makes the API re-live the historical temperature
# trajectory instead of tracking the sensor (observed Sep 6 2026:
# sensorTemps.heatsinkC climbing 16->19C while the live frzTemp `hs` stream
# fell to 14.5C), and the wall-clock throttle compounds it by posting the
# oldest record of each 30s window and suppressing the fresher ones behind
# it. Mirrors RECENT_RECORD_WINDOW in stream/stream.py, which already
# applies the same guard to piezo records.
SENSOR_TEMPS_MAX_RECORD_AGE = 120  # seconds


def _frz_record_epoch(record: dict):
    """Epoch seconds of a frzTemp/frzHealth record's `ts`, or None if missing/unparseable.

    Live records carry epoch seconds; load_raw_files-style replays may have
    already rewritten `ts` to a '%Y-%m-%d %H:%M:%S' UTC string.
    """
    ts = record.get('ts')
    if isinstance(ts, bool):
        return None
    if isinstance(ts, (int, float)):
        return float(ts)
    if isinstance(ts, str):
        try:
            return datetime.strptime(ts, '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc).timestamp()
        except ValueError:
            return None
    return None


def is_biometrics_enabled() -> bool:
    try:
        services_db_file_path = '/persistent/free-sleep-data/lowdb/servicesDB.json'
        if os.path.isfile(services_db_file_path):
            print('Loading servicesDB.json...')
            with open(services_db_file_path) as file:
                services_db = json.load(file)
                return services_db["biometrics"]["enabled"]
        else:
            logger.error(f'File not found! {services_db_file_path}')
            return False
    except Exception as error:
        logger.error('Error checking if biometrics is enabled, returning false')
        logger.error(error)
        return False



def update_health(job_key: str, status: str, message: str = ''):
    try:
        logger.debug(f'Updating health status for {job_key} - {status} - {message}')

        data = json.dumps({
            "biometrics": {
                "jobs": {
                    job_key: {
                        "status": status,
                        "message": message,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    }
                }
            },
        }).encode("utf-8")

        req = urllib.request.Request(
            "http://127.0.0.1:3000/api/services",
            headers={"Content-Type": "application/json"},
            method="POST",
            data=data,
        )

        with urllib.request.urlopen(req, timeout=1) as response:
            if response.status == 200:
                logger.debug("Updated status successfully")
            else:
                print(f"Unexpected status: {response.status}")

    except Exception as error:
        logger.error('Failed updating calibration status')
        logger.error(error)


def update_sensor_temps(frz_temp_data: dict):
    """
    Updates sensor temperature readings from frzTemp data.
    Called by the biometrics stream processor when temperature readings are received.
    Throttled to avoid flooding the server (updates at most every 30 seconds).
    """
    global _last_sensor_temps_update

    now = time.time()

    # Drop replayed/stale records before the throttle check so they cannot
    # consume the 30s window and shadow the live records behind them. A
    # record with no parseable ts is treated as live rather than discarded.
    record_epoch = _frz_record_epoch(frz_temp_data)
    if record_epoch is None or not math.isfinite(record_epoch) or not 0 <= now - record_epoch <= 90:
        logger.debug('Skipping invalid or stale frzTemp timestamp')
        return

    # Throttle updates
    if now - _last_sensor_temps_update < SENSOR_TEMPS_UPDATE_INTERVAL:
        return
    _last_sensor_temps_update = now

    try:
        logger.debug(f'Updating sensor temps - amb={frz_temp_data.get("amb")}')

        # lastUpdated reflects when the reading was taken, not when it was
        # posted; stamping now() here is what hid the replay staleness.
        if record_epoch is not None:
            last_updated = datetime.fromtimestamp(record_epoch, timezone.utc).isoformat()
        else:
            last_updated = datetime.now(timezone.utc).isoformat()

        data = json.dumps({
            "biometrics": {
                "sensorTemps": {
                    "ambient": frz_temp_data.get("amb"),
                    "heatsink": frz_temp_data.get("hs"),
                    "left": frz_temp_data.get("left"),
                    "right": frz_temp_data.get("right"),
                    "lastUpdated": last_updated,
                }
            },
        }).encode("utf-8")

        req = urllib.request.Request(
            "http://127.0.0.1:3000/api/services",
            headers={"Content-Type": "application/json"},
            method="POST",
            data=data,
        )

        with urllib.request.urlopen(req, timeout=1) as response:
            if response.status == 200:
                logger.debug("Updated sensor temps successfully")
            else:
                logger.warning(f"Unexpected status updating sensor temps: {response.status}")

    except Exception as error:
        logger.error('Failed updating sensor temps')
        logger.error(error)


# Pump monitoring uses managed commanded power, explicit water detection and
# fresh RPM. Reported TEC current does not reliably distinguish on from off.
# Six consecutive fresh frames (~1 minute) latch a stall; three recover it.
# Gaps and replayed frames must not advance either dwell counter.
_PUMP_RPM_STALL_THRESHOLD = 200
_PUMP_STALL_DWELL_FRAMES = 6
_PUMP_RECOVERY_DWELL_FRAMES = 3
PUMP_HEALTH_MAX_RECORD_AGE = 30  # seconds

def new_pump_state() -> dict:
    """Per-side dwell state. Shared with the tests so the two cannot drift."""
    return {
        'consecutive_stall': 0,
        'consecutive_healthy': 0,
        'is_stalled': False,
        'reported_healthy': False,
        'prev_pump_ok': None,
        'last_sample_at': None,
        'last_report_at': 0,
        'last_report': None,
    }


_pump_state = {'left': new_pump_state(), 'right': new_pump_state()}


def _pump_power_status():
    """Use the managed hardware API; never infer commanded power from TEC current."""
    try:
        with urllib.request.urlopen('http://127.0.0.1:3000/api/deviceStatus', timeout=1) as response:
            status = json.load(response)
        if status.get('isPriming') is not False:
            return None
        return {side: status.get(side, {}).get('isOn') for side in ('left', 'right')}
    except Exception:
        return None


def update_pump_health(frz_health_data: dict):
    """Report known commanded state, unknown telemetry and sustained circulation faults."""
    report_circulation(frz_health_data)
    now = time.time()
    stamp = _frz_record_epoch(frz_health_data)
    if stamp is None or not math.isfinite(stamp) or not 0 <= now - stamp <= PUMP_HEALTH_MAX_RECORD_AGE:
        return
    power = _pump_power_status()
    for side in ('left', 'right'):
        state = _pump_state[side]
        previous = state['last_sample_at']
        if previous is not None and stamp <= previous:
            continue
        if previous is not None and stamp - previous > 30:
            state['consecutive_stall'] = state['consecutive_healthy'] = 0
        state['last_sample_at'] = stamp
        commanded_on = power.get(side) if power else None
        pump = (frz_health_data.get(side) or {}).get('pump') or {}
        rpm, water = pump.get('rpm'), pump.get('water')
        pump_ok = type(rpm) in (int, float) and math.isfinite(rpm) and rpm >= _PUMP_RPM_STALL_THRESHOLD and water is True
        if state['prev_pump_ok'] != pump_ok:
            logger.info(f"pump health {side} transition: pump_ok {state['prev_pump_ok']} -> {pump_ok}, pump={pump}")
        state['prev_pump_ok'] = pump_ok
        known = type(rpm) in (int, float) and math.isfinite(rpm) and rpm >= 0 and isinstance(water, bool)
        if not isinstance(commanded_on, bool):
            state['consecutive_stall'] = state['consecutive_healthy'] = 0
            report = ('retrying', 'Pump state unknown: commanded power unavailable or priming.')
        elif not commanded_on:
            state['consecutive_stall'] = 0
            state['consecutive_healthy'] += 1
            if state['consecutive_healthy'] >= _PUMP_RECOVERY_DWELL_FRAMES:
                state['is_stalled'] = False
            report = ('healthy', 'Side is off; pump stopped.' if rpm == 0 else 'Side is off.')
        elif not known:
            state['consecutive_stall'] = state['consecutive_healthy'] = 0
            report = ('retrying', 'Pump state unknown: RPM or water detection missing.')
        else:
            pump_ok = rpm >= _PUMP_RPM_STALL_THRESHOLD and water is True
            if pump_ok:
                state['consecutive_stall'] = 0
                state['consecutive_healthy'] += 1
                if state['consecutive_healthy'] >= _PUMP_RECOVERY_DWELL_FRAMES:
                    state['is_stalled'] = False
            else:
                state['consecutive_healthy'] = 0
                state['consecutive_stall'] += 1
                if state['consecutive_stall'] >= _PUMP_STALL_DWELL_FRAMES:
                    state['is_stalled'] = True
            if state['is_stalled']:
                report = ('failed', 'Pump stall suspected while side is on. Check pump RPM and water detection.')
            elif not pump_ok:
                report = ('retrying', 'Waiting for circulation while side is on.')
            else:
                report = ('healthy', 'Side is on; pump running and water detected.')
        # Refresh both state transitions and heartbeat, including normal off-to-on.
        if report != state['last_report'] or now - state['last_report_at'] >= 30:
            update_health('pump' + side.capitalize(), *report)
            state['last_report'] = report
            state['last_report_at'] = now
            state['reported_healthy'] = report[0] == 'healthy'
