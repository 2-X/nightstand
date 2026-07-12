"""
This module defines the `BiometricProcessor` class, which processes biometric signals
from piezoelectric sensors to extract heart rate, heart rate variability (HRV), and
breathing rate. It applies signal cleaning, filtering, and outlier detection to ensure
accurate physiological measurements.

Key functionalities:
- Detects user presence based on piezo signal range.
- Applies preprocessing steps such as outlier interpolation, scaling, and filtering.
- Extracts heart rate, HRV, and breathing rate using a sliding window approach.
- Validates heart rate values against defined thresholds to reduce false positives.
- Periodically inserts smoothed biometric data into an SQL database.
- Supports multiple sensors and handles missing or noisy signals.
- Implements garbage collection for memory efficiency.

Usage:
Instantiate `BiometricProcessor` and call `calculate_vitals(epoch, signal1, signal2)`
with sensor data to process and extract biometric metrics.
"""
import datetime
import gc
import os
from typing import Union, Tuple, TypedDict, List, Optional, Deque
import traceback
import numpy as np
import json
from collections import deque
import urllib.request
import urllib.error

from get_logger import get_logger
from heart.exceptions import BadSignalWarning
from vitals.run_data_types import RuntimeParams
from vitals.cleaning import interpolate_outliers_in_wave
from heart.preprocessing import scale_data
from heart.filtering import filter_signal, remove_baseline_wander
from heart.heartpy import process
from db import insert_vitals
from data_types import *
from presence_floor import (
    low_percentile,
    floor_looks_empty,
    ambiguous_should_advance,
    update_occupied_floor_est,
    FLOOR_PERCENTILE,
    FLOOR_MIN_WINDOW,
    FLOOR_EMPTY_FRACTION,
    FLOOR_EMA_ALPHA,
    AMBIGUOUS_FREEZE_CAP,
    AMBIGUOUS_LEAK_DIVISOR,
)

logger = get_logger()

# Cadence (in ticks, ~1/tick-second) for the throttled `[presence-debug]`
# snapshot log below. Default matches long-standing behavior (~60s). Override
# with PRESENCE_DEBUG_LOG_INTERVAL_S=1 for a labeled-night data-collection
# window when per-tick resolution is needed (e.g. validating a synchrony/floor
# discriminator). Remember to unset it afterward, since interval=1 is a ~60x
# increase in this log line's volume against the rotating log budget.
_PRESENCE_DEBUG_LOG_INTERVAL_S = max(1, int(os.getenv('PRESENCE_DEBUG_LOG_INTERVAL_S', '60')))


class _PresenceCoordinator:
    """
    Shared state for cross-side presence arbitration.

    Each piezo sensor picks up some of the OTHER side's signal via mechanical
    transmission through the mattress. So if you lie on the left, the right
    sensor also goes well above the empty-bed noise floor, just at a lower
    amplitude than left. Naively thresholding each side independently produces
    false positives ("right side is occupied" when only the left is).

    Strategy:
      1. Each BiometricProcessor reports its current signal_range here.
      2. We compare both sides and decide who's actually present, using:
         - A noise-floor threshold (sides below this are definitely empty)
         - A dominance ratio (one side ≥ DOMINANCE_RATIO × the other → only
           the dominant side counts as present)
      3. Each BiometricProcessor reads back its own per-side decision and
         uses it (with its existing hysteresis) to decide whether to POST.

    Module-level singleton, there's only ever one bed.
    """

    # Bumped 30k → 100k → 150k after observing real numbers. Occupied jumps to
    # 200k-16M (even on the OFF side via mattress transmission), so 150k keeps
    # a 25% margin below the weakest occupied signal. The earlier "empty bed
    # maxes at ~10k" assumption didn't hold: an empty side has been observed
    # idling at 40k-110k (both sides off, nobody home), and its occasional
    # spikes past 100k kept resetting the exit counter, presence stayed
    # latched for hours and the calibration job's occupancy guard never let
    # calibration run.
    NOISE_THRESHOLD = 150_000
    DOMINANCE_RATIO = 1.3      # one side must be ≥ 1.3× the other to be "alone"

    _latest = {'left': 0.0, 'right': 0.0}

    @classmethod
    def report(cls, side: str, signal_range: float) -> dict:
        """Update this side's range and return the decision for both sides."""
        cls._latest[side] = signal_range
        return cls._decide()

    @classmethod
    def _decide(cls) -> dict:
        L = cls._latest['left']
        R = cls._latest['right']

        left_above = L >= cls.NOISE_THRESHOLD
        right_above = R >= cls.NOISE_THRESHOLD

        if not left_above and not right_above:
            return {'left': False, 'right': False}
        if left_above and not right_above:
            return {'left': True, 'right': False}
        if right_above and not left_above:
            return {'left': False, 'right': True}

        # Both above noise, disambiguate using ratio.
        if L >= R * cls.DOMINANCE_RATIO:
            return {'left': True, 'right': False}   # left clearly dominant
        if R >= L * cls.DOMINANCE_RATIO:
            return {'left': False, 'right': True}   # right clearly dominant

        # Roughly equal AND both high → both occupied
        return {'left': True, 'right': True}

    @classmethod
    def snapshot(cls) -> dict:
        """For debug logging, current state of both sides."""
        return {'left_range': cls._latest['left'], 'right_range': cls._latest['right']}

    @classmethod
    def is_above_noise(cls, side: str) -> bool:
        return cls._latest[side] >= cls.NOISE_THRESHOLD


class BiometricProcessor:
    heart_rates: Deque[float]   # Store last moving_avg_size heart rates (120)
    breath_rates: Deque[float]  # Store last breath rates
    hrv_rates: Deque[float]     # Store last HRV rates
    lower_bound: Optional[np.floating]  # Lower bound of HR (None if not set)
    upper_bound: Optional[np.floating]  # Upper bound of HR (None if not set)
    hr_moving_avg: Optional[np.floating]  # Current moving average heart rate
    hr_std_2: Optional[float]  # Standard deviation of heart rate
    epoch: int
    def __init__(
            self,
            side: str = 'left',
            sensor_count=1,
            runtime_params: RuntimeParams = None,
            insertion_frequency=60,
            rolling_average_size=25,
            debug=False,
            api_host='127.0.0.1',  # Added API configuration
            api_port=3000,  # Added API configuration
    ):
        self.present = False
        self.side = side
        self.sensor_count = sensor_count
        self.insertion_frequency = insertion_frequency
        self.iteration_count = 0
        self.rolling_average_size = rolling_average_size
        self.debug = debug

        # API configuration for presence updates
        self.api_host = api_host
        self.api_port = api_port
        self.presence_api_url = f'http://{api_host}:{api_port}/api/metrics/presence'

        self.heart_rate_window_seconds = 3
        self.breath_rate_window_seconds = 30
        self.breath_rate_insertion_frequency = 10

        self.hrv_window_seconds = 300
        self.hrv_insertion_frequency = 30


        if runtime_params is None:
            runtime_params: RuntimeParams = {
                'window': 3,
                'slide_by': 1,
                'moving_avg_size': 120,
                'hr_std_range': (1, 10),
                'hr_percentile': (15, 80),
                'signal_percentile': (0.2, 99.8),
                'window_size': 0.65,
            }

        self.slide_by = runtime_params['slide_by']  # Sliding window step size in seconds
        self.window = runtime_params['window']  # Window size in seconds
        self.hr_std_range = runtime_params['hr_std_range']  # Heart rate standard deviation range (lower, upper)
        self.hr_percentile = runtime_params['hr_percentile']  # Accepted percentile range for heart rate (lower, upper)
        self.moving_avg_size = runtime_params['moving_avg_size']  # Moving average window size in seconds
        self.signal_percentile = runtime_params['signal_percentile']  # Percent of outliers from raw signal to replace
        self.window_size = runtime_params['window_size']
        self.runtime_params = runtime_params
        self.init_tracking()
        # Was 30s. A user reported a side's "in-bed" indicator going yellow
        # after the occupant stayed still for a while, then green again on
        # movement. Cause: piezos are AC-coupled, a perfectly still person
        # produces only tiny breathing-amplitude signal that can fall below
        # threshold for stretches of a minute or more. Bumping the tolerance
        # to 3 minutes gives way more grace before declaring the bed empty,
        # at the cost of detecting "person actually got out of bed" 3 min
        # later instead of 30s later.
        self.no_presence_tolerance = 180
        self.breathing_rate = 0
        self.hrv = 0
        self.not_present_for = 0
        self.present_for = 0
        # Re-POST the current presence state every N seconds even when nothing
        # changed. Without this:
        #   - A server restart wipes the in-memory presenceData, but Python
        #     never re-tells it (only POSTs on transitions). The dot stays
        #     yellow/grey until the user gets out of bed.
        #   - The auto-off monitor only knows lastPresenceAt = "first moment
        #     we saw them tonight", that goes stale by hours and would fire
        #     prematurely. The heartbeat keeps it within a minute of "now".
        self._presence_heartbeat_interval = 60
        self._presence_heartbeat_counter = 0
        # Tracks "the other side has been clearly dominant", drives one of
        # the two short-session fast-exit triggers below.
        self._time_since_clearly_dominant = 0
        # Wall-clock seconds since this side transitioned to present. Used
        # to gate fast-exit eligibility: fresh sessions (< _established_threshold)
        # are eligible for 30 s fast-exit; established sessions are protected
        # by the slow 3-min grace. This is what differentiates a still,
        # sleeping occupant (long established session, signal drops because
        # they're asleep) from a climb-in transient (short session, signal
        # drops because the user is actually settled on the OTHER side).
        self._presence_session_seconds = 0
        self._established_threshold = 60
        self._fast_exit_grace = 30
        # Consecutive clearly-dominant frames seen while mid-exit (not_present_for
        # > 0). BUG-01: a piezo permanently loaded by pillows/a topper idles close
        # to NOISE_THRESHOLD and spikes above it every few minutes even with
        # nobody in bed. A lone dominant frame used to hard-reset the exit clock,
        # so a spiky-but-empty side never reached the 180s slow-exit and stayed
        # latched "present" for hours. Now a single spike just holds the exit
        # clock steady; only a short sustained streak counts as a real return.
        self._reentry_streak = 0
        self._REENTRY_CONFIRM_FRAMES = 3
        # Rolling window of recent signal_range observations. Originally a
        # 60-sample debug log; now ALSO the input to the BUG-04 rolling-floor
        # discriminator below, so it holds a full FLOOR_MIN_WINDOW (~5 min at
        # 1 Hz) -- long enough for a stable low-percentile "between-burst
        # floor" without lagging real departures too badly. Still cheap (a few
        # hundred floats).
        self._recent_ranges: Deque[float] = deque([], maxlen=FLOOR_MIN_WINDOW)
        self._range_log_counter = 0
        # --- BUG-04: is_ambiguous_both exit-freeze discriminators ---
        # The `is_ambiguous_both` branch used to freeze the exit clock
        # unconditionally, which let an empty side latch "present" for hours
        # via cross-mattress crosstalk. We break the freeze by comparing a low
        # percentile of THIS side's own recent range (its between-burst floor)
        # against its OWN learned occupied floor -- biased hard toward staying
        # present (a wrongly-aborted thermal session is worse than a late
        # auto-off). See presence_floor.py for the pure decision helpers.
        self._FLOOR_PERCENTILE = FLOOR_PERCENTILE
        self._FLOOR_MIN_WINDOW = FLOOR_MIN_WINDOW
        # "Empty-looking" = rolling floor below this fraction of the learned
        # occupied floor. Deliberately conservative (0.30): on the 2026-07-11
        # fixture the occupied rolling-p20 sat ~2.5M and the crosstalk floor
        # ~0.7M (~0.28x of it), so 0.30 catches the crosstalk case while
        # leaving a large margin above any genuine still-sleeper dip (whose
        # rolling p20 never approached this even during a brief ~0.87M
        # instantaneous dip that recovered within a minute). Lower = safer
        # against false exit but catches less crosstalk; chosen for the
        # approved bias, so it only PARTIALLY closes the false-latch problem.
        self._FLOOR_EMPTY_FRACTION = FLOOR_EMPTY_FRACTION
        # Slow EMA so a momentary still stretch cannot drag the reference down.
        self._FLOOR_EMA_ALPHA = FLOOR_EMA_ALPHA
        # Learned per-side occupied floor (in-process EMA; None until seeded
        # from real clear-dominance frames). It lives here rather than in the
        # daily calibrate_sensor_thresholds.py job on purpose: calibration
        # learns the EMPTY-bed baseline, but this freeze needs the OCCUPIED-vs-
        # crosstalk floor, which is only observable live while the side is
        # genuinely occupied (design 2c spells out why the empty baseline is
        # the wrong reference here). Cleared on exit so each session relearns.
        self._occupied_floor_est: Optional[float] = None
        # Backstop (2d): even with an inconclusive floor, an unbroken run of
        # ambiguous_both frames longer than this leaks the exit clock forward
        # (at 1/leak-divisor rate) so nothing can freeze it forever. Set long
        # and slow so it is effectively unreachable for a genuinely present
        # sleeper (whose floor resolves the case first) -- a pure "never latch
        # forever" guarantee, not the primary lever.
        self._AMBIGUOUS_FREEZE_CAP = AMBIGUOUS_FREEZE_CAP
        self._AMBIGUOUS_LEAK_DIVISOR = AMBIGUOUS_LEAK_DIVISOR
        self._ambiguous_streak = 0
        self.combined_measurements: Deque[Measurement] = deque([], maxlen=100)
        self.debug_measurements: List[Measurement] = []

    def init_tracking(self):
        # Running metrics
        self.heart_rates:  Deque[float] = deque([], maxlen=self.moving_avg_size)
        self.breath_rates:  Deque[float] = deque([], maxlen=6)
        # HRV varies meaningfully between sleep stages (high in REM, low in
        # deep), so we don't want to average it away. Was maxlen=10 which -
        # combined with the 30 s hrv_insertion_frequency, was a 5-minute
        # smoothing window, exactly the granularity we want to preserve.
        # Keep a 3-reading (~90 s) window: enough to suppress per-tick spikes,
        # not enough to erase the per-epoch variability the stage classifier
        # uses.
        self.hrv_rates:  Deque[float] = deque([], maxlen=3)
        self.lower_bound = None
        self.upper_bound = None
        self.hr_moving_avg = None
        self.hr_std_2 = None

    def reset(self):
        self.iteration_count = 0
        self.init_tracking()

    def _update_presence_api(self, is_present: bool):
        """
        Send presence update to the API endpoint.

        Args:
            is_present: Boolean indicating if presence is detected
        """
        try:
            # Build the payload based on which side this processor handles
            payload = {
                self.side: {
                    "present": is_present,
                }
            }

            # Convert payload to JSON bytes
            data = json.dumps(payload).encode('utf-8')

            # Create the request
            req = urllib.request.Request(
                self.presence_api_url,
                data=data,
                headers={'Content-Type': 'application/json'},
                method='POST'
            )

            # Make the request with timeout
            with urllib.request.urlopen(req, timeout=2) as response:
                if response.status == 200:
                    logger.debug(f'Successfully updated presence API for {self.side} side: {is_present}')
                else:
                    response_body = response.read().decode('utf-8')
                    logger.warning(f'Presence API returned status {response.status}: {response_body}')

        except urllib.error.URLError as e:
            if isinstance(e.reason, TimeoutError):
                logger.warning(f'Presence API request timed out for {self.side} side')
            else:
                logger.warning(f'Could not connect to presence API at {self.presence_api_url}: {e.reason}')
        except Exception as e:
            logger.error(f'Error updating presence API: {e}')

    # Sane ceiling (magnitude, checked symmetrically) for a raw piezo sample,
    # used to mask out sensor-glitch garbage before computing the p98-p2
    # range. 16_777_215 (2^24 - 1) is a hard 24-bit ADC/processing clip
    # ceiling -- no legitimate reading can physically exceed it (confirmed
    # on-pod, e.g. 16_777_215 and 14_654_897 during an active dual-occupancy
    # session). 25M gives that hard ceiling ~8.2M (1.5x) of headroom while
    # still rejecting the known garbage sentinel (~2.15B, e.g.
    # 2_148_008_185) by ~86x. The bound is symmetric because raw piezo
    # samples are signed int32 (see load_raw_files.py's
    # np.frombuffer(..., dtype=np.int32)): int32 overflow/wraparound
    # produces large-magnitude NEGATIVE garbage just as readily as positive
    # -- that same 2_148_008_185 sentinel, reinterpreted as signed 32-bit
    # wraparound, lands at -2_146_959_111.
    _SANE_MAX_SIGNAL = 25_000_000

    @staticmethod
    def _range_p98_p2(signal: np.ndarray) -> float:
        """Percentile-based range robust to int32 sentinels and stray outliers."""
        if signal is None or signal.size == 0:
            return 0.0
        s = signal.astype(np.int64, copy=False)
        # Mask out individual garbage samples rather than discarding the
        # whole window -- a single sensor-glitch sample shouldn't throw away
        # an otherwise-valid second of real signal. Symmetric bound: see
        # _SANE_MAX_SIGNAL's comment for why negative garbage needs the same
        # treatment as positive.
        s = s[np.abs(s) <= BiometricProcessor._SANE_MAX_SIGNAL]
        if s.size == 0:
            # Every sample in the window was garbage: no real signal left
            # to measure.
            return 0.0
        p2, p98 = np.percentile(s, [2, 98])
        return float(p98 - p2)

    def _exit_presence(self):
        """Tear down presence state on any exit (slow, fast, or ambiguous-floor).

        Centralizes the previously-duplicated exit side effects and also clears
        the BUG-04 floor state, so a later re-entry relearns its own occupied
        floor from scratch rather than measuring the next occupant against the
        last one's.
        """
        self.present = False
        self.reset()
        self.present_for = 0
        self._presence_session_seconds = 0
        self._time_since_clearly_dominant = 0
        self._reentry_streak = 0
        self._ambiguous_streak = 0
        self._occupied_floor_est = None
        self._update_presence_api(False)
        self._presence_heartbeat_counter = 0

    def detect_presence(self, signal1: np.ndarray, signal2: Union[None, np.ndarray] = None):
        # Each side has TWO physical piezos (head + foot of that half of the
        # bed). Until now presence detection only looked at signal1, throwing
        # away half the available information. Use the MAX of the two, a
        # person on the side compresses both piezos directly, so taking the
        # max picks up activity even if the person's body is closer to one
        # piezo than the other.
        r1 = self._range_p98_p2(signal1)
        r2 = self._range_p98_p2(signal2) if signal2 is not None else 0.0
        signal_range = max(r1, r2)

        self._recent_ranges.append(signal_range)

        # Cross-side arbitration: report our range to the coordinator and let
        # it tell us whether THIS side is actually occupied (vs just picking
        # up mechanical transmission from the other side).
        decision = _PresenceCoordinator.report(self.side, signal_range)
        other_side = 'right' if self.side == 'left' else 'left'

        # Three mutually exclusive outcomes from the coordinator:
        #   - is_clearly_dominant: "I'm clearly the one occupied" (decision_self
        #     True AND decision_other False), strong signal that justifies
        #     entering or staying present.
        #   - is_ambiguous_both: "both above noise, neither dominant by 1.3×"
        #    , usually cross-mattress transmission while a single user moves
        #     heavily on one side. NEVER counts toward entering present.
        #     Holds existing presence steady (doesn't decrement either way).
        #   - else: this side has no signal worth speaking of, count toward exit.
        is_clearly_dominant = decision[self.side] and not decision[other_side]
        other_is_clearly_dominant = decision[other_side] and not decision[self.side]
        is_ambiguous_both = decision[self.side] and decision[other_side]

        # BUG-04 rolling-floor discriminator (see presence_floor.py + plans).
        # rolling_floor = a low percentile of THIS side's own recent range (its
        # between-burst floor). floor_empty is True only with strong evidence
        # this side is unoccupied: window full AND floor collapsed well below
        # its learned occupied reference. It stays False during warmup and
        # whenever we have no reference yet -- i.e. it defaults to "stay
        # present", per the approved bias.
        window_ready = len(self._recent_ranges) >= self._FLOOR_MIN_WINDOW
        rolling_floor = low_percentile(list(self._recent_ranges), self._FLOOR_PERCENTILE)
        floor_empty = floor_looks_empty(
            rolling_floor, self._occupied_floor_est,
            self._FLOOR_EMPTY_FRACTION, window_ready,
        )
        # Learn this side's occupied floor only from confident real occupancy:
        # clear dominance while the floor does NOT look empty. Crosstalk bursts
        # are clearly-dominant too (an empty side's range can momentarily even
        # exceed the occupied side's), so gating on `not floor_empty` keeps
        # them from dragging the reference down toward the crosstalk floor.
        if is_clearly_dominant and window_ready and not floor_empty:
            self._occupied_floor_est = update_occupied_floor_est(
                self._occupied_floor_est, rolling_floor, self._FLOOR_EMA_ALPHA,
            )

        if is_clearly_dominant:
            self._time_since_clearly_dominant = 0
        elif other_is_clearly_dominant:
            self._time_since_clearly_dominant += 1

        # Periodic debug log
        self._range_log_counter += 1
        if self._range_log_counter >= _PRESENCE_DEBUG_LOG_INTERVAL_S:
            self._range_log_counter = 0
            snap = _PresenceCoordinator.snapshot()
            logger.info(
                f'[presence-debug] {self.side}: max={signal_range:.0f} '
                f'p1={r1:.0f} p2={r2:.0f} '
                f'L={snap["left_range"]:.0f} R={snap["right_range"]:.0f} '
                f'decision_L={decision["left"]} decision_R={decision["right"]} '
                f'present={self.present} not_present_for={self.not_present_for} '
                f'session={self._presence_session_seconds}s '
                f'floor={rolling_floor:.0f} occ_est={self._occupied_floor_est or 0:.0f} '
                f'floor_empty={floor_empty} ambig_streak={self._ambiguous_streak}'
            )

        if is_clearly_dominant:
            # Real signal on this side. Advance entry counter.
            self.present_for += 1
            self._ambiguous_streak = 0
            if self.not_present_for == 0:
                self._reentry_streak = 0
            elif floor_empty:
                # BUG-04: this "return" is a crosstalk burst on a side whose
                # rolling floor still looks empty, not a real re-entry -- under
                # strong crosstalk the empty side's range can momentarily even
                # exceed the occupied side's. Hold the exit clock steady
                # (neither reset nor advance) so the ambiguous_both floor path
                # can keep counting toward exit. Gated on floor_empty, so a
                # genuinely present sleeper (high floor) keeps the original
                # confirm-streak reset behavior unchanged.
                self._reentry_streak = 0
            else:
                # Mid-exit and this side just went clearly dominant again.
                # Require a short sustained streak, not a lone frame, before
                # cancelling the exit clock (see the _reentry_streak comment
                # in __init__ for why).
                self._reentry_streak += 1
                if self._reentry_streak >= self._REENTRY_CONFIRM_FRAMES:
                    self.not_present_for = 0
                    self._reentry_streak = 0
            # Require ≥5 consecutive seconds of *clear* dominance to enter.
            # Was 3 + "any decision_self True"; bumped to 5 + clear-dominance-only
            # to filter brief climb-in transients where the user's body crosses
            # the wrong-side piezo for a few seconds before settling.
            if not self.present and self.present_for >= 5:
                self.present = True
                self._presence_session_seconds = 0
                self._update_presence_api(True)
                self._presence_heartbeat_counter = 0
        elif is_ambiguous_both:
            # Both above noise, neither dominant. We can't tell from one tick
            # whether this is real two-person occupancy or cross-transmission,
            # so we don't reset present_for here (that lets a second person
            # joining an already-occupied bed accumulate the 5 s of clear
            # dominance gradually even when interleaved with ambiguous moments).
            #
            # BUG-04: this branch USED to freeze the exit clock unconditionally,
            # which let an empty side latch present for hours via crosstalk.
            # Now, while present, we advance the exit clock when this side's
            # rolling floor looks empty (2b), or leak it once the ambiguous
            # state has frozen too long regardless of floor (2d backstop). When
            # the floor still looks occupied we freeze exactly as before -- so a
            # genuinely present quiet sleeper is unaffected.
            self._reentry_streak = 0
            if self.present:
                self._ambiguous_streak += 1
                if ambiguous_should_advance(
                    floor_empty, self._ambiguous_streak,
                    self._AMBIGUOUS_FREEZE_CAP, self._AMBIGUOUS_LEAK_DIVISOR,
                ):
                    self.not_present_for += 1
                    if self.not_present_for == self.no_presence_tolerance:
                        logger.info(
                            f'Slow exit on {self.side} side: ambiguous crosstalk '
                            f'(floor={rolling_floor:.0f} occ_est='
                            f'{self._occupied_floor_est or 0:.0f}) reached '
                            f'{self.no_presence_tolerance}s'
                        )
                        self._exit_presence()
            else:
                self._ambiguous_streak = 0
        else:
            # No signal here. Count toward exit.
            # Only reset the entry counter if we haven't entered presence yet.
            # While we ARE present, present_for doubles as the "seconds since
            # presence started" gate that downstream calculations (HR, HRV,
            # breath rate) rely on. Resetting it here on every quiet moment
            #, which happens routinely during deep sleep when the signal
            # falls below the noise threshold, would prevent HRV (300 s
            # gate) from ever recomputing during long sessions, leaving the
            # rolling-average `self.hrv` frozen at its first stable value.
            # The slow-exit / fast-exit blocks below explicitly reset
            # present_for when a session truly ends.
            self._reentry_streak = 0
            self._ambiguous_streak = 0
            if not self.present:
                self.present_for = 0
            self.not_present_for += 1
            if self.not_present_for == self.no_presence_tolerance:
                logger.info(
                    f'Slow exit on {self.side} side: '
                    f'no signal for {self.no_presence_tolerance}s'
                )
                self._exit_presence()

        # Short-session fast-exit. The slow 3-min grace exists for established
        # sleep, an occupant stops moving, signal drops below noise, but
        # they're still there. We don't want to bypass it for established
        # presence. But within the first _established_threshold seconds we DO
        # want to bail quickly if either:
        #   (a) the signal is gone and stays gone (climb-in transient that
        #       triggered presence on the wrong side, then user settled on
        #       the OTHER side, both sides go below noise as the user lies
        #       still); or
        #   (b) the OTHER side becomes clearly dominant (= user is genuinely
        #       on the other side, our "presence" is just transmission).
        if (
            self.present
            and self._presence_session_seconds < self._established_threshold
            and (
                self.not_present_for >= self._fast_exit_grace
                or self._time_since_clearly_dominant >= self._fast_exit_grace
            )
        ):
            reason = (
                f'no signal for {self.not_present_for}s'
                if self.not_present_for >= self._fast_exit_grace
                else f'other side dominant for {self._time_since_clearly_dominant}s'
            )
            logger.info(
                f'Fast exit on {self.side} side: short session '
                f'({self._presence_session_seconds}s), {reason}'
            )
            self._exit_presence()

        # Tick the wall-clock session counter LAST so it reflects "seconds
        # since entry" at the next call's checks.
        if self.present:
            self._presence_session_seconds += 1

        # Periodic heartbeat: re-POST the current state even when nothing
        # changed. detect_presence is called once per second so this fires
        # every _presence_heartbeat_interval seconds.
        self._presence_heartbeat_counter += 1
        if self._presence_heartbeat_counter >= self._presence_heartbeat_interval:
            self._presence_heartbeat_counter = 0
            self._update_presence_api(self.present)

    def _calculate_vitals(self, signal: np.ndarray, epoch: int, update_breathing=False, update_hrv=False):
        try:
            # Remove outliers from signal
            data = interpolate_outliers_in_wave(
                signal,
                lower_percentile=self.signal_percentile[0],
                upper_percentile=self.signal_percentile[1],
            )

            data = scale_data(data, lower=0, upper=1024)
            data = remove_baseline_wander(data, sample_rate=500.0, cutoff=0.05)

            data = filter_signal(
                data,
                cutoff=[0.5, 20.0],
                sample_rate=500.0,
                order=2,
                filtertype='bandpass'
            )

            working_data, measurement = process(
                data,
                500,
                breathing_method='fft',
                bpmmin=40,
                bpmmax=90,
                windowsize=self.window_size,
                calculate_breathing=update_breathing,
            )
            if update_breathing:
                breathing_rate = measurement.get('breathingrate', 0) * 60
                if (8 <= breathing_rate <= 20) and not np.isnan(breathing_rate):
                    self.breath_rates.append(breathing_rate)
                    breathing_rate = sum(self.breath_rates) / len(self.breath_rates)
                    if not np.isnan(breathing_rate):
                        self.breathing_rate = breathing_rate

            if update_hrv:
                hrv = measurement['sdnn']
                if (8 <= hrv <= 200) and not np.isnan(hrv):
                    self.hrv_rates.append(hrv)
                    hrv = sum(self.hrv_rates) / len(self.hrv_rates)

                    if not np.isnan(hrv):
                        self.hrv = hrv


            if self.is_valid(measurement):
                return {
                    'side': self.side,
                    'timestamp': epoch,
                    'heart_rate': measurement['bpm'],
                    'hrv': self.hrv,
                    'breathing_rate': self.breathing_rate,
                }
        except BadSignalWarning:
            return None
        except Exception as e:
            error_message = traceback.format_exc()
            logger.error(e)
            logger.error(error_message)
            return None

    def calculate_heart_rate(self, epoch: int, signal1: np.ndarray, signal2: Union[None, np.ndarray] = None):
        self.epoch = epoch
        measurement_2 = None
        measurement_1 = self._calculate_vitals(signal1, epoch)

        if signal2 is not None:
            measurement_2 = self._calculate_vitals(signal2, epoch)

        if measurement_1 is not None and measurement_2 is not None:
            m1_heart_rate = measurement_1['heart_rate']
            m2_heart_rate = measurement_2['heart_rate']
            if self.hr_moving_avg is not None:
                heart_rate = (((m1_heart_rate + m2_heart_rate) / 2) + self.hr_moving_avg) / 2
            else:
                heart_rate = (m1_heart_rate + m2_heart_rate) / 2

            if self.hr_moving_avg is not None and abs(heart_rate - self.hr_moving_avg) > self.hr_std_2:
                if heart_rate < self.hr_moving_avg:
                    heart_rate = self.hr_moving_avg - self.hr_std_2
                else:
                    heart_rate = self.hr_moving_avg + self.hr_std_2

            self.heart_rates.append(heart_rate)

            self.combined_measurements.append({
                'side': self.side,
                'timestamp': epoch,
                'heart_rate': heart_rate,
                'hrv': self.hrv,
                'breathing_rate': self.breathing_rate,
            })

        elif measurement_1 is not None:
            m1_heart_rate = measurement_1['heart_rate']

            # If the HR differs by more than the allowable movement
            if self.hr_moving_avg is not None and abs(m1_heart_rate - self.hr_moving_avg) > self.hr_std_2:
                if m1_heart_rate < self.hr_moving_avg:
                    m1_heart_rate = self.hr_moving_avg - self.hr_std_2
                else:
                    m1_heart_rate = self.hr_moving_avg + self.hr_std_2

            self.heart_rates.append(m1_heart_rate)

            measurement_1['heart_rate'] = m1_heart_rate
            self.combined_measurements.append(measurement_1)

        elif measurement_2 is not None:
            m2_heart_rate = measurement_2['heart_rate']

            if self.hr_moving_avg is not None:
                heart_rate = (m2_heart_rate + self.hr_moving_avg) / 2
            else:
                heart_rate = m2_heart_rate

            if self.hr_moving_avg is not None and abs(heart_rate - self.hr_moving_avg) > self.hr_std_2:
                if heart_rate < self.hr_moving_avg:
                    heart_rate = self.hr_moving_avg - self.hr_std_2
                else:
                    heart_rate = self.hr_moving_avg + self.hr_std_2

            self.heart_rates.append(heart_rate)

            measurement_2['heart_rate'] = heart_rate
            self.combined_measurements.append(measurement_2)
        self.next()

    def is_valid(self, measurement) -> bool:
        if np.isnan(measurement['bpm']):
            return False

        if measurement['bpm'] > 90:
            return False
        if self.lower_bound is not None and self.upper_bound is not None:
            if self.lower_bound < measurement['bpm'] < self.upper_bound:
                return True
            else:
                return False
        return True

    def next(self):
        self.iteration_count += 1

        # Insert moving average heart rate to DB
        if self.iteration_count % self.insertion_frequency == 0 and len(self.combined_measurements) > 0:
            heart_rate = np.mean(list(self.heart_rates)[self.rolling_average_size * -1:])
            # Convert last heart rate to average
            self.combined_measurements[-1]['heart_rate'] = heart_rate
            if not self.debug:
                # Presence gate (BUG-03): a side with nobody on it right now
                # must not write vitals. Without this, a departed/empty side
                # kept inserting at full rate: first the OTHER side's real
                # heartbeat (picked up mechanically through the shared
                # mattress frame), then noise once the whole bed was empty.
                # self.present is updated by detect_presence(), which runs
                # earlier in the same processing tick (see
                # StreamProcessor.process_piezo_record), so this reflects the
                # current frame with no one-tick lag.
                #
                # Known limitation: this only helps when self.present is
                # itself correct. If cross-mattress transmission is still
                # fooling detect_presence() into holding self.present True
                # on the wrong side (dual-occupancy crosstalk -- a different,
                # already-tracked presence-detection problem, not the noise-
                # spike issue fixed earlier), this gate will not catch it.
                if self.present:
                    insert_vitals(self.combined_measurements[-1])
                else:
                    logger.debug(
                        f'Skipping vitals insert for {self.side} side: not present'
                    )
            else:
                last_combined_measurement = list(self.combined_measurements)[-1]
                ts = datetime.utcfromtimestamp(last_combined_measurement['timestamp']).isoformat()
                debug_measurement = {
                    **self.combined_measurements[-1],
                    'last_combined_measurement': ts,
                    'current_ts': datetime.utcfromtimestamp(self.epoch).isoformat(),
                    'heart_rate': heart_rate,
                    'last_heart_rates': list(self.heart_rates)[-25:],
                    'hr_moving_avg': self.hr_moving_avg,
                    'lower_bound': self.lower_bound,
                    'upper_bound': self.upper_bound,
                    'hr_std_2': self.hr_std_2,
                    'length': len(self.heart_rates),
                }
                self.debug_measurements.append(debug_measurement)

        # Calculate boundaries for calculations
        if len(self.heart_rates) >= self.moving_avg_size:
            self.hr_moving_avg = np.mean(self.heart_rates)

            self.lower_bound = np.percentile(self.heart_rates, self.hr_percentile[0])
            self.upper_bound = np.percentile(self.heart_rates, self.hr_percentile[1])

            if self.upper_bound - self.lower_bound < 25:
                self.upper_bound = self.hr_moving_avg + 12.5
                self.lower_bound = self.hr_moving_avg - 12.5

            self.hr_std_2 = np.std(self.heart_rates) * 2
            if self.hr_std_2 < self.hr_std_range[0]:
                self.hr_std_2 = self.hr_std_range[0]
            elif self.hr_std_2 > self.hr_std_range[1]:
                self.hr_std_2 = self.hr_std_range[1]

    def calculate_breath_rate(self, signal1: np.ndarray, epoch: int):
        self._calculate_vitals(signal1, epoch, update_breathing=True)


    def calculate_hrv(self, signal1: np.ndarray, epoch: int):
        self._calculate_vitals(signal1, epoch, update_hrv=True)
