from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from vitals2.gates import HR_MIN_QUALITY, HR_RANGE, RESP_MIN_QUALITY, RESP_RANGE

ESTIMATOR = 2
# A minute's heart rate needs this many passing windows, and this share of
# them within HR_AGREEMENT of their median. Unsettled minutes scatter.
MIN_HR_WINDOWS = 4
HR_AGREEMENT = 0.08
HR_AGREEMENT_SHARE = 0.6
# The band the legacy hrv column has always held; outside it the column says 0.
LEGACY_HRV_RANGE = (8, 200)


@dataclass(frozen=True)
class WindowEstimate:
    timestamp: int
    value: float | None
    quality: float
    usable: bool = True


@dataclass(frozen=True)
class HrvEstimate:
    timestamp: int
    rmssd: float | None
    sdnn: float | None
    coverage: float


def round_half_up(value: float, digits: int = 0) -> float:
    scale = 10 ** digits
    return math.floor(value * scale + 0.5) / scale


def _passing(windows: list[WindowEstimate], min_quality: float, bounds: tuple[float, float]) -> list[WindowEstimate]:
    return [window for window in windows
            if window.usable and window.value is not None and window.quality >= min_quality
            and bounds[0] <= window.value <= bounds[1]]


def _settled_rate(hr_windows: list[WindowEstimate]) -> tuple[float, float] | None:
    heart = _passing(hr_windows, HR_MIN_QUALITY, HR_RANGE)
    if len(heart) < MIN_HR_WINDOWS:
        return None
    rates = np.array([window.value for window in heart])
    rate = float(np.median(rates))
    if np.mean(np.abs(rates - rate) <= HR_AGREEMENT * rate) < HR_AGREEMENT_SHARE:
        return None
    return rate, float(np.median([window.quality for window in heart]))


def minute_row(side: str, minute_start: int, hr_windows: list[WindowEstimate],
               resp_windows: list[WindowEstimate], hrv: HrvEstimate | None) -> dict | None:
    """One vitals row from a minute of window estimates, or None without a heart rate.

    The heart rate is the median of the minute's passing windows when they
    agree; otherwise there is no row. The legacy columns get the same numbers
    in their long-standing units, with 0 for no estimate.
    """
    settled = _settled_rate(hr_windows)
    if settled is None:
        return None
    heart_rate, hr_quality = settled
    rmssd = hrv.rmssd if hrv else None
    sdnn = hrv.sdnn if hrv else None
    breaths = _passing(resp_windows, RESP_MIN_QUALITY, RESP_RANGE)
    resp_rate = float(np.median([window.value for window in breaths])) if breaths else None
    legacy_hrv = sdnn is not None and LEGACY_HRV_RANGE[0] <= sdnn <= LEGACY_HRV_RANGE[1]
    return {
        'side': side,
        'timestamp': minute_start,
        'heart_rate': int(round_half_up(heart_rate)),
        'hrv': int(round_half_up(sdnn)) if legacy_hrv else 0,
        'breathing_rate': int(round_half_up(resp_rate)) if resp_rate is not None else 0,
        'hr_quality': round_half_up(hr_quality, 2),
        'rmssd': round_half_up(rmssd, 1) if rmssd is not None else None,
        'sdnn': round_half_up(sdnn, 1) if sdnn is not None else None,
        'hrv_coverage': round_half_up(hrv.coverage, 2) if hrv else None,
        'resp_rate': round_half_up(resp_rate, 1) if resp_rate is not None else None,
        'resp_quality': round_half_up(float(np.median([window.quality for window in breaths])), 2) if breaths else None,
        'estimator': ESTIMATOR,
    }
