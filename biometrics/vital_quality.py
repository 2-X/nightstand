"""Validity of derived measurements; unknown is not a physiological zero."""
import math
from numbers import Real


def fresh_metric(value, measured_at, now, maximum_age):
    if (not isinstance(value, Real) or isinstance(value, bool) or not math.isfinite(value) or value <= 0
            or type(measured_at) not in (int, float) or not math.isfinite(measured_at)
            or not 0 <= now - measured_at <= maximum_age):
        return None
    return value


def has_contiguous_window(records, seconds):
    if len(records) < seconds:
        return False
    rows = list(records)[-seconds:]
    stamps = [row.get('ts') for row in rows]
    if any(type(stamp) not in (int, float) or not math.isfinite(stamp) for stamp in stamps):
        return False
    if any(not 0.5 <= current - previous <= 1.5 for previous, current in zip(stamps, stamps[1:])):
        return False
    # This processor is calibrated for 500 Hz, one second per record.
    return all(row.get('freq') == 500 and all(len(row.get(side, [])) == 500
               for side in ('left1', 'right1')) for row in rows)
