"""Detector thresholds from what calibration has learned about this bed.

`profiles` is what calibration.load_presence_profiles returns:
{side: {'cap': payload or None, 'cap_occupied': payload or None,
        'piezo_floors': [recent empty-bed floors, newest first]}}.
"""
from __future__ import annotations

import math
import statistics
from typing import Dict, Optional

from .cap import CapBaseline
from .detector import OFFSET_LIMIT, SIDES, DetectorParams, SideParams
from .sensors import CAPSENSE2, CapFormat

CHANNELS = ('out', 'cen', 'in')
# Entry at this share of the side's usual occupied rise, exit at half of entry.
# For a capSense2 rise of 10 that is 4 and 2, the levels validated on real nights.
ENTER_FRACTION = 0.4
EXIT_RATIO = 0.5
# The fixed levels below are in capSense2 units; side_params scales them by
# the format's unit. Starting entry, before a side has a learned rise.
DEFAULT_ENTER_DELTA = 4.0
# Entry never drops below partner-only spikes (p99 about 3 on real capSense2
# nights) or below this multiple of the calibrated empty-bed noise, and never
# rises past where a light sleeper would be missed.
ENTER_MIN = 3.0
NOISE_MULTIPLE = 6.0
ENTER_MAX = 10.0
# Piezo floor when none is learned yet; with PIEZO_ALIVE_MARGIN this is the
# 150,000 bar both detectors used before floors were learned.
DEFAULT_PIEZO_FLOOR = 75_000.0
PIEZO_FLOOR_MIN = 30_000.0
PIEZO_FLOOR_MAX = 150_000.0


def side_params(occupied_level: Optional[float], noise: float, unit: float = 1.0) -> SideParams:
    """Entry and exit for one side; unit converts the fixed levels to the format's raw units."""
    floor = max(ENTER_MIN * unit, NOISE_MULTIPLE * noise)
    enter = DEFAULT_ENTER_DELTA * unit if occupied_level is None else ENTER_FRACTION * occupied_level
    enter = min(ENTER_MAX * unit, max(floor, enter))
    return SideParams(enter_delta=enter, exit_delta=enter * EXIT_RATIO, offset_limit=OFFSET_LIMIT * unit)


def piezo_floor(floors) -> float:
    """Median of the recent learned floors, bounded; the default when none are usable."""
    if not isinstance(floors, (list, tuple)):
        floors = ()
    usable = [_number(value) for value in floors if _positive(value)]
    if not usable:
        return DEFAULT_PIEZO_FLOOR
    return min(PIEZO_FLOOR_MAX, max(PIEZO_FLOOR_MIN, statistics.median(usable)))


def baselines_from_calibration(profiles) -> Optional[Dict[str, CapBaseline]]:
    """Both sides' capacitance baselines, or None unless both are calibrated."""
    baselines = {}
    for side in SIDES:
        baseline = _cap_baseline(side, _side_entry(profiles, side).get('cap'))
        if baseline is None:
            return None
        baselines[side] = baseline
    return baselines


def params_from_calibration(profiles, cap_format: CapFormat = CAPSENSE2) -> Optional[DetectorParams]:
    """Detector parameters in cap_format's units, or None when there is no capacitance baseline to detect against."""
    baselines = baselines_from_calibration(profiles)
    if baselines is None:
        return None
    sides = {}
    floors = {}
    for side in SIDES:
        entry = _side_entry(profiles, side)
        sides[side] = side_params(_occupied_level(entry.get('cap_occupied')), baselines[side].noise, cap_format.unit)
        floors[side] = piezo_floor(entry.get('piezo_floors'))
    return DetectorParams(left=sides['left'], right=sides['right'], piezo_floor=floors)


def learned_levels(profiles) -> bool:
    """Whether both sides have a learned occupied capacitance level."""
    return all(_occupied_level(_side_entry(profiles, side).get('cap_occupied')) is not None for side in SIDES)


def _side_entry(profiles, side: str) -> dict:
    entry = profiles.get(side) if isinstance(profiles, dict) else None
    return entry if isinstance(entry, dict) else {}


def _cap_baseline(side: str, payload) -> Optional[CapBaseline]:
    if not isinstance(payload, dict):
        return None
    readings = payload.get('reading_means')
    readings = readings if isinstance(readings, dict) else {}
    mean = []
    for channel in CHANNELS:
        entry = payload.get(f'{side}_{channel}')
        value = _number(entry.get('mean')) if isinstance(entry, dict) else None
        if value is None:
            return None
        reading = _number(readings.get(channel))
        mean.append(value if reading is None else reading)
    noise = payload.get('delta_noise')
    return CapBaseline(mean=tuple(mean), noise=_number(noise) if _positive(noise) else 0.0)


def _occupied_level(payload) -> Optional[float]:
    level = payload.get('level') if isinstance(payload, dict) else None
    return _number(level) if _positive(level) else None


def _number(value) -> Optional[float]:
    """A finite float, or None for anything else, bools and ints too large for a float included."""
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except OverflowError:
        return None
    return number if math.isfinite(number) else None


def _positive(value) -> bool:
    number = _number(value)
    return number is not None and number > 0
