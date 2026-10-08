# Reader behavior from https://github.com/LTimothy/nightstand, v3.6.1
from __future__ import annotations

def load_baseline(side: Side):
    """The active capSense baseline, or None when nothing is calibrated yet.

    Reads the calibration store first and falls back to the legacy JSON file
    for one release, so a pod rolled forward mid-cycle still finds its
    baseline. Returns None rather than raising: never having calibrated is a
    normal state on a fresh install, and callers skip capacitive presence and
    use the piezo signal alone.
    """
    try:
        profile = calibration.get_profile(side, 'cap')
    except sqlite3.Error as e:
        logger.warning(f'Calibration store read failed for the {side} side, falling back to the legacy file: {e}')
        profile = None

    if profile is not None:
        return profile['payload']

    file_path = RIGHT_CAP_BASELINE_FILE_PATH if side == 'right' else LEFT_CAP_BASE_LINE_FILE_PATH
    try:
        if calibration.import_legacy_baseline(side, file_path):
            imported = calibration.get_profile(side, 'cap')
            if imported is not None:
                return imported['payload']
    except sqlite3.Error as e:
        logger.warning(f'Calibration store unavailable while importing the legacy {side} baseline: {e}')

    logger.warning(
        f'No capSense baseline for the {side} side yet. Calibration runs '
        'automatically once the sensors record a stretch of empty bed.'
    )
    return None
