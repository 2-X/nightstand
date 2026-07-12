"""Pure, numpy-free helpers for the cross-side presence rolling-floor
discriminator (BUG-04: the `is_ambiguous_both` exit-freeze).

Kept dependency-light (standard library only) for two reasons:
  1. it lets these decision functions be unit-tested on any Python, including
     environments without numpy installed; and
  2. the logic is small, pure, and easier to reason about (and to bias
     correctly toward *not* exiting) in isolation than inline inside
     `detect_presence`.

The physical idea: a genuinely occupied side holds a continuous
between-burst floor (breathing plus micro-movement); an empty side
receiving cross-mattress crosstalk sags back toward its baseline in the
gaps between the partner's movement bursts. The instantaneous max is
useless during bursts (both sides can clip the ADC ceiling identically),
so this keys off a *low percentile* of a side's own recent range,
measured relative to that side's own *learned occupied floor*.
"""
from typing import Optional, Sequence
import math

# Default parameters. The live values are copied onto each BiometricProcessor
# instance in __init__ (so tests can tune them per-instance); the rationale for
# each number lives at that call site.
FLOOR_PERCENTILE = 20
FLOOR_MIN_WINDOW = 300        # samples (~5 min at 1 Hz) before the floor is trusted
FLOOR_EMPTY_FRACTION = 0.30   # rolling floor below 30% of the learned occupied floor => empty-looking
FLOOR_EMA_ALPHA = 0.02        # slow adaptation of the per-side occupied-floor reference
AMBIGUOUS_FREEZE_CAP = 600    # continuous ambiguous frames before the backstop leak engages
AMBIGUOUS_LEAK_DIVISOR = 4    # then advance the exit clock ~1 tick in this many


def low_percentile(values: Sequence[float], percentile: float) -> float:
    """Linear-interpolated percentile of a plain sequence of floats.

    A numpy-free stand-in for ``np.percentile(values, percentile)`` (the
    default "linear" method), used to compute the rolling between-burst floor.
    Returns 0.0 for an empty sequence.
    """
    if not values:
        return 0.0
    ordered = sorted(values)
    n = len(ordered)
    if n == 1:
        return float(ordered[0])
    k = (n - 1) * (percentile / 100.0)
    lo = math.floor(k)
    hi = math.ceil(k)
    if lo == hi:
        return float(ordered[int(k)])
    return float(ordered[lo] * (hi - k) + ordered[hi] * (k - lo))


def floor_looks_empty(rolling_floor: float,
                      occupied_floor_est: Optional[float],
                      fraction: float,
                      window_ready: bool) -> bool:
    """True only when there is strong evidence THIS side is unoccupied.

    Deliberately biased toward returning False (=> stay present): if the window
    is not yet full, or we have no learned occupied-floor reference for this
    side yet, return False and defer to the existing freeze/hysteresis. A side
    is only "empty-looking" once its rolling floor has collapsed well below its
    own learned occupied floor.
    """
    if not window_ready:
        return False
    if occupied_floor_est is None or occupied_floor_est <= 0.0:
        return False
    return rolling_floor < occupied_floor_est * fraction


def ambiguous_should_advance(is_empty: bool,
                             ambiguous_streak: int,
                             freeze_cap: int,
                             leak_divisor: int) -> bool:
    """Whether the exit clock should advance this tick inside `is_ambiguous_both`.

    - Primary lever (2b): advance whenever the floor looks empty.
    - Backstop (2d): otherwise, once the ambiguous state has persisted past
      ``freeze_cap`` continuous frames, leak the clock forward at
      ``1/leak_divisor`` of full rate, so an inconclusive floor can never
      freeze the exit indefinitely. Set long and slow on purpose.
    """
    if is_empty:
        return True
    if freeze_cap > 0 and leak_divisor > 0 and ambiguous_streak > freeze_cap:
        return ambiguous_streak % leak_divisor == 0
    return False


def update_occupied_floor_est(occupied_floor_est: Optional[float],
                              rolling_floor: float,
                              alpha: float) -> float:
    """Slow EMA of the per-side occupied floor. Seeds on the first sample."""
    if occupied_floor_est is None:
        return float(rolling_floor)
    return float(occupied_floor_est + alpha * (rolling_floor - occupied_floor_est))
