import sys
import platform
import os
from datetime import datetime, timezone
import time

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

        with urllib.request.urlopen(req) as response:
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

    # Throttle updates
    now = time.time()
    if now - _last_sensor_temps_update < SENSOR_TEMPS_UPDATE_INTERVAL:
        return
    _last_sensor_temps_update = now

    try:
        logger.debug(f'Updating sensor temps - amb={frz_temp_data.get("amb")}')

        data = json.dumps({
            "biometrics": {
                "sensorTemps": {
                    "ambient": frz_temp_data.get("amb"),
                    "heatsink": frz_temp_data.get("hs"),
                    "left": frz_temp_data.get("left"),
                    "right": frz_temp_data.get("right"),
                    "lastUpdated": datetime.now(timezone.utc).isoformat(),
                }
            },
        }).encode("utf-8")

        req = urllib.request.Request(
            "http://127.0.0.1:3000/api/services",
            headers={"Content-Type": "application/json"},
            method="POST",
            data=data,
        )

        with urllib.request.urlopen(req) as response:
            if response.status == 200:
                logger.debug("Updated sensor temps successfully")
            else:
                logger.warning(f"Unexpected status updating sensor temps: {response.status}")

    except Exception as error:
        logger.error('Failed updating sensor temps')
        logger.error(error)


# Pump stall detection. The hub water-temperature sensor sits next to the
# heating/cooling element (TEC), not in the bed. While the pump circulates,
# it reads moving water leaving the bed, meaningful. If the pump stalls
# while the TEC keeps drawing current, the sensor reads stagnant water next
# to a powered heating element instead: a runaway number that doesn't
# reflect bed temperature. This exact failure mode was reported by a
# free-sleep user (side ran to 102F against an 84F setpoint overnight,
# cleared by a power cycle) and independently documented by sleepypod/core's
# ADR 0022. Verified against this pod's live frzHealth frames: pump RPM
# running ~1900-2000, TEC current several amps when actively heating/cooling
#, a >200 RPM floor while TEC is active is a wide, conservative margin.
_PUMP_RPM_STALL_THRESHOLD = 200
_PUMP_TEC_ACTIVE_AMPS = 1.0
# frzHealth frames arrive roughly once every 10s; 6 consecutive ~= 1 minute
# of sustained stall before alerting, 3 consecutive ~= 30s of recovery
# before clearing, avoids flapping on a single noisy frame in either
# direction, without needing to know whether the side was "commanded on"
# (TEC current itself is the "commanded active" signal).
_PUMP_STALL_DWELL_FRAMES = 6
_PUMP_RECOVERY_DWELL_FRAMES = 3

_pump_state = {
    'left': {'consecutive_stall': 0, 'consecutive_healthy': 0, 'is_stalled': False, 'reported_healthy': False},
    'right': {'consecutive_stall': 0, 'consecutive_healthy': 0, 'is_stalled': False, 'reported_healthy': False},
}


def update_pump_health(frz_health_data: dict):
    """
    Watches frzHealth frames (pump RPM/water + TEC current per side) for a
    stalled-pump-while-heating condition and reports it to the Status page
    via the same update_health() job-status mechanism as other biometrics
    jobs. Called from the stream processor for every frzHealth frame.
    """
    try:
        for side in ('left', 'right'):
            side_data = frz_health_data.get(side) or {}
            tec = side_data.get('tec') or {}
            pump = side_data.get('pump') or {}
            current = tec.get('current')
            rpm = pump.get('rpm')
            water = pump.get('water')

            # Missing current/rpm can't confirm an active stall (tec_active
            # requires `current`), so treat it the same as "TEC not active"
            # rather than skipping the frame outright. A side that's fully
            # powered off stops carrying live TEC/pump numbers in frzHealth;
            # skipping froze the dwell counters entirely, so a stall latched
            # right before power-off could never reach the recovery dwell and
            # stayed 'failed' indefinitely.
            tec_active = current is not None and abs(current) >= _PUMP_TEC_ACTIVE_AMPS
            pump_ok = rpm is not None and rpm >= _PUMP_RPM_STALL_THRESHOLD and water is not False
            state = _pump_state[side]

            # Per-frame trace for diagnosing whether a stall onset is a real
            # mechanical stall or a momentary frame-data artifact:
            # there was previously no way to inspect the raw values leading
            # up to a trip.
            logger.debug(
                f'pump health {side}: current={current} rpm={rpm} water={water} '
                f'tec_active={tec_active} pump_ok={pump_ok} '
                f'consecutive_stall={state["consecutive_stall"]} consecutive_healthy={state["consecutive_healthy"]}'
            )

            if tec_active and not pump_ok:
                state['consecutive_stall'] += 1
                state['consecutive_healthy'] = 0
            else:
                state['consecutive_healthy'] += 1
                state['consecutive_stall'] = 0

            job_key = f'pump{side.capitalize()}'

            if not state['is_stalled'] and state['consecutive_stall'] >= _PUMP_STALL_DWELL_FRAMES:
                state['is_stalled'] = True
                state['reported_healthy'] = True
                message = (
                    f'Pump stall suspected on {side} side: TEC drawing {current:.1f}A '
                    f'(actively heating/cooling) but pump rpm={rpm}, water={water}. '
                    f'The hub temperature sensor may be reading stagnant water next to '
                    f'the heating element, not actual bed temperature.'
                )
                logger.error(message)
                update_health(job_key, 'failed', message)
            elif state['is_stalled'] and state['consecutive_healthy'] >= _PUMP_RECOVERY_DWELL_FRAMES:
                state['is_stalled'] = False
                logger.info(f'Pump on {side} side recovered: rpm={rpm}, water={water}')
                update_health(job_key, 'healthy', '')
            elif not state['is_stalled'] and not state['reported_healthy'] and pump_ok:
                state['reported_healthy'] = True
                update_health(job_key, 'healthy', '')
    except Exception as error:
        logger.error('Failed updating pump health')
        logger.error(error)
