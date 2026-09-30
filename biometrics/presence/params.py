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
from .detector import SIDES, DetectorParams, SideParams

CHANNELS = ('out', 'cen', 'in')
# Entry at this share of the side's usual occupied rise, exit at half of entry.
# For a rise of 10 that is 4 and 2, the levels validated on real nights.
ENTER_FRACTION = 0.4
EXIT_RATIO = 0.5
# Before a side has a learned occupied rise.
DEFAULT_ENTER_DELTA = 4.0
# Entry never drops below partner-only spikes (p99 about 3 on real nights)
# or below this multiple of the calibrated empty-bed noise, and never rises
# past where a light sleeper would be missed.
ENTER_MIN = 3.0
NOISE_MULTIPLE = 6.0
ENTER_MAX = 10.0
# Piezo floor when none is learned yet; with PIEZO_ALIVE_MARGIN this is the
# 150,000 bar both detectors used before floors were learned.
DEFAULT_PIEZO_FLOOR = 75_000.0
PIEZO_FLOOR_MIN = 30_000.0
PIEZO_FLOOR_MAX = 150_000.0


def side_params(occupied_level: Optional[float], noise: float) -> SideParams:
    floor = max(ENTER_MIN, NOISE_MULTIPLE * noise)
    enter = DEFAULT_ENTER_DELTA if occupied_level is None else ENTER_FRACTION * occupied_level
    enter = min(ENTER_MAX, max(floor, enter))
    return SideParams(enter_delta=enter, exit_delta=enter * EXIT_RATIO)


def piezo_floor(floors) -> float:
    """Median of the recent learned floors, bounded; the default when none are usable."""
    usable = [float(value) for value in floors or () if _positive(value)]
    if not usable:
        return DEFAULT_PIEZO_FLOOR
    return min(PIEZO_FLOOR_MAX, max(PIEZO_FLOOR_MIN, statistics.median(usable)))


def baselines_from_calibration(profiles) -> Optional[Dict[str, CapBaseline]]:
    """Both sides' capacitance baselines, or None unless both are calibrated."""
    baselines = {}
    for side in SIDES:
        baseline = _cap_baseline(side, ((profiles or {}).get(side) or {}).get('cap'))
        if baseline is None:
            return None
        baselines[side] = baseline
    return baselines


def params_from_calibration(profiles) -> Optional[DetectorParams]:
    """Detector parameters, or None when there is no capacitance baseline to detect against."""
    baselines = baselines_from_calibration(profiles)
    if baselines is None:
        return None
    sides = {}
    floors = {}
    for side in SIDES:
        entry = profiles.get(side) or {}
        sides[side] = side_params(_occupied_level(entry.get('cap_occupied')), baselines[side].noise)
        floors[side] = piezo_floor(entry.get('piezo_floors'))
    return DetectorParams(left=sides['left'], right=sides['right'], piezo_floor=floors)


def _cap_baseline(side: str, payload) -> Optional[CapBaseline]:
    try:
        mean = tuple(float(payload[f'{side}_{channel}']['mean']) for channel in CHANNELS)
    except (TypeError, KeyError, ValueError):
        return None
    if not all(math.isfinite(value) for value in mean):
        return None
    noise = payload.get('delta_noise')
    return CapBaseline(mean=mean, noise=float(noise) if _positive(noise) else 0.0)


def _occupied_level(payload) -> Optional[float]:
    level = payload.get('level') if isinstance(payload, dict) else None
    return float(level) if _positive(level) else None


def _positive(value) -> bool:
    return (
        isinstance(value, (int, float)) and not isinstance(value, bool)
        and math.isfinite(value) and value > 0
    )
