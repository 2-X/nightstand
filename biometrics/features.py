"""Runtime feature switches, read from the server's settings file."""
import json
import os
from typing import Optional

from get_logger import data_folder

SETTINGS_FILE = 'lowdb/settingsDB.json'


def _settings_path() -> str:
    return os.path.join(data_folder(), SETTINGS_FILE)


def biometrics_v2_enabled(settings_path: Optional[str] = None) -> bool:
    """True only when settings.features.biometricsV2 is exactly true.

    A missing file, unreadable JSON, or settings written by a version without
    the switch all read as off, so the existing behavior stays in charge.
    """
    try:
        with open(settings_path or _settings_path()) as handle:
            settings = json.load(handle)
        return settings.get('features', {}).get('biometricsV2') is True
    except Exception:
        return False
