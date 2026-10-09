"""Capacitance provenance shared by calibration writers and consumers."""
import hashlib
import json
import math
from typing import Optional

# Version 1 uses legacy channel counts or the first three capSense2 pair means.
CAP_NORMALIZATION_VERSION = 1
CAP_FORMATS = ('capSense', 'capSense2')


def source_hash(records) -> str:
    """Hash normalized source records without materializing a second window."""
    hasher = hashlib.sha256()
    for record in records:
        hasher.update(json.dumps(record, sort_keys=True, separators=(',', ':')).encode())
        hasher.update(b'\n')
    return hasher.hexdigest()


def cap_provenance(cap_formats, source_hash: str, origin: str = 'nightstand') -> dict:
    names = [name for name, count in cap_formats.items() if count and name != 'unknown']
    if len(names) != 1 or names[0] not in CAP_FORMATS:
        raise ValueError('Calibration requires a single known capacitance format')
    return {'format': names[0], 'normalizationVersion': CAP_NORMALIZATION_VERSION,
            'origin': origin, 'sourceHash': source_hash}


def baseline_payload(value, file_hash: str) -> Optional[dict]:
    """Keep channels readable by older versions and retain imported provenance."""
    if not isinstance(value, dict):
        return None
    if 'format' in value:
        if (value['format'] not in CAP_FORMATS or type(value.get('version')) is not int
                or value['version'] != CAP_NORMALIZATION_VERSION):
            return None
        channels = value.get('channels')
        if not isinstance(channels, dict):
            return None
        payload = dict(channels)
        payload['provenance'] = {'format': value['format'], 'normalizationVersion': value.get('version'),
                                 'origin': 'upstream', 'sourceHash': file_hash}
    else:
        payload = dict(value)
        if 'provenance' in payload and not provenance_matches(payload, payload['provenance'].get('format')
                                                              if isinstance(payload['provenance'], dict) else None):
            return None
    return payload


def provenance_matches(payload, cap_format) -> bool:
    if not isinstance(payload, dict):
        return False
    # Nightstand calibrations written before provenance was added keep their units.
    if 'provenance' not in payload:
        return True
    name = getattr(cap_format, 'name', cap_format)
    provenance = payload.get('provenance')
    return (name in CAP_FORMATS and isinstance(provenance, dict)
            and provenance.get('format') == name
            and type(provenance.get('normalizationVersion')) is int
            and provenance['normalizationVersion'] == CAP_NORMALIZATION_VERSION)


def observed_cap_format(counts) -> Optional[str]:
    names = [name for name, count in counts.items() if count and name != 'unknown'] if isinstance(counts, dict) else []
    return names[0] if len(names) == 1 and names[0] in CAP_FORMATS else None


def valid_channels(payload, side) -> bool:
    try:
        for channel in ('out', 'cen', 'in'):
            entry = payload[f'{side}_{channel}']
            for key in ('mean', 'std'):
                value = entry[key]
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                    return False
            if entry['std'] <= 0:
                return False
        return True
    except (KeyError, TypeError, OverflowError):
        return False
