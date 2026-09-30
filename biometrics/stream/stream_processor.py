"""
This module defines the `StreamProcessor` class, which processes continuous piezoelectric
sensor data to track user presence and extract biometric metrics such as heart rate,
heart rate variability (HRV), and breathing rate.

Key functionalities:
- Buffers incoming piezoelectric sensor data to process trends over time.
- Detects user presence based on signal strength for both left and right sides.
- Uses `BiometricProcessor` to analyze heart rate, HRV, and breathing rate.
- Supports single and dual-sensor configurations.
- Maintains a rolling buffer of sensor readings to smooth out noise.
- Extracts timestamped biometric data and logs presence detections.

Usage:
Instantiate `StreamProcessor` with an initial piezo record and call `process_piezo_record(piezo_record)`
with new sensor data to continuously track and analyze biometric trends.
"""
import sys
from typing import Dict, Optional, Tuple
from get_logger import get_logger
from biometric_processor import BiometricProcessor
from buffer import Buffer
from data_types import *
from presence.cap import CAP_HOLD_SECONDS, CapBaseline, cap_delta
from presence.detector import FRAME_GAP_SECONDS, DetectorParams, PresenceDetector, piezo_range
import numpy as np

logger = get_logger()

# An entry this soon after the other side emptied, onto a side whose own last
# exit came earlier, is taken as the partner moving across, so the side's
# vitals state is cleared instead of carried over.
SIDE_SWAP_SECONDS = 120
# How far ahead of the clock a reading may be stamped and still count as current.
CAP_FUTURE_TOLERANCE_SECONDS = 5

PresenceInputs = Tuple[DetectorParams, Dict[str, CapBaseline]]


class LatestCap:
    """Newest capSense2 values for both sides, written by the reader thread."""

    def __init__(self):
        self._reading = None

    def update(self, ts, left_values, right_values) -> None:
        # One assignment, so the processing thread never sees half an update.
        self._reading = (int(ts), left_values, right_values)

    def read(self):
        return self._reading

    def is_fresh(self, now: float, max_age: float) -> bool:
        reading = self._reading
        return reading is not None and -CAP_FUTURE_TOLERANCE_SECONDS <= now - reading[0] <= max_age


def is_side_swap(entering: BiometricProcessor, other: BiometricProcessor, epoch: int) -> bool:
    """True when this entry looks like the partner moving across, not the side's occupant returning."""
    if other.present or other.last_exit_at is None:
        return False
    if not 0 <= epoch - other.last_exit_at <= SIDE_SWAP_SECONDS:
        return False
    return entering.last_exit_at is None or other.last_exit_at >= entering.last_exit_at


class StreamProcessor:
    def __init__(
            self,
            piezo_record,
            debug=False,
            cap_source: Optional[LatestCap] = None,
    ):
        if 'left2' in piezo_record:
            self.sensor_count = 2
        else:
            self.sensor_count = 1
        self.left_processor = BiometricProcessor(side='left', sensor_count=self.sensor_count, insertion_frequency=60, debug=debug)
        self.right_processor = BiometricProcessor(side='right', sensor_count=self.sensor_count, insertion_frequency=60, debug=debug)
        self.buffer = Buffer(
            self.right_processor.heart_rate_window_seconds,
            self.right_processor.breath_rate_window_seconds,
            self.right_processor.hrv_window_seconds,
        )
        self.iteration_count = 0
        self.cap_source = cap_source
        # Set through use_presence_v2. None leaves presence to the piezo detector.
        self.presence: Optional[PresenceDetector] = None
        self._presence_inputs: Optional[PresenceInputs] = None
        self._presence_epoch: Optional[int] = None

    def use_presence_v2(self, inputs: Optional[PresenceInputs]) -> None:
        """Hand presence to the capacitance detector (inputs) or back to piezo (None).

        A change of detector ends any current session, so the new one starts
        from an empty bed. New calibration for a running detector waits until
        nobody is in the bed.
        """
        if inputs is None:
            if self.presence is not None:
                logger.info('Presence switching to the piezo detector')
                self._end_sessions()
                self.presence = None
                self._presence_inputs = None
            return
        if self.presence is None:
            logger.info('Presence switching to the capacitance detector')
            self._end_sessions()
        elif inputs == self._presence_inputs or any(self.presence.state().values()):
            return
        self.presence = PresenceDetector(inputs[0])
        self._presence_inputs = inputs
        self._presence_epoch = None

    def _end_sessions(self) -> None:
        self.left_processor.end_presence_session()
        self.right_processor.end_presence_session()

    def _step_presence(self, piezo_record) -> None:
        epoch = int(piezo_record['ts'])
        # The detector reads a repeated or earlier second as a break in the
        # frames, so drop one; a long step back is a clock change and goes through.
        if self._presence_epoch is not None and 0 <= self._presence_epoch - epoch <= FRAME_GAP_SECONDS:
            return
        self._presence_epoch = epoch
        baselines = self._presence_inputs[1]
        cap = {'left': None, 'right': None}
        reading = self.cap_source.read() if self.cap_source is not None else None
        if reading is not None and abs(epoch - reading[0]) <= CAP_HOLD_SECONDS:
            cap = {
                'left': cap_delta(reading[1], baselines['left']),
                'right': cap_delta(reading[2], baselines['right']),
            }
        piezo = {
            'left': piezo_range(piezo_record.get('left1')),
            'right': piezo_range(piezo_record.get('right1')),
        }
        states = self.presence.step(epoch, cap, piezo)
        left, right = self.left_processor, self.right_processor
        left_swap = states['left'] and not left.present and is_side_swap(left, right, epoch)
        right_swap = states['right'] and not right.present and is_side_swap(right, left, epoch)
        # The side the partner came from keeps nothing for whoever lies down there next.
        if left_swap:
            right.reset()
        if right_swap:
            left.reset()
        left.apply_presence(states['left'], epoch, reset_state=left_swap)
        right.apply_presence(states['right'], epoch, reset_state=right_swap)

    def check_presence(
        self,
        left1_signal: np.ndarray,
        right1_signal: np.ndarray,
        left2_signal=None,
        right2_signal=None,
    ):
        # Pass both piezos per side so detect_presence can use the max of
        # head + foot piezo, improves coverage when a person isn't centred
        # over a single sensor and gives the coordinator more signal to
        # distinguish real occupancy from asymmetric transmission.
        self.left_processor.detect_presence(left1_signal, left2_signal)
        self.right_processor.detect_presence(right1_signal, right2_signal)

    def can_calculate_breath_rate(self):
        return (
            self.iteration_count > self.left_processor.breath_rate_window_seconds
            and self.iteration_count % self.left_processor.breath_rate_insertion_frequency == 0
        )

    def can_calculate_hrv(self):
        return (
            self.iteration_count > self.left_processor.hrv_window_seconds
            and self.iteration_count % self.left_processor.hrv_insertion_frequency == 0
        )

    def process_piezo_record(self, piezo_record: PiezoDualData):
        self.iteration_count += 1
        self.buffer.append(piezo_record)
        if self.presence is not None:
            self._step_presence(piezo_record)
        if self.iteration_count > self.left_processor.heart_rate_window_seconds:
            left1_signal = self.buffer.get_heart_rate_signal('left', 1)
            right1_signal = self.buffer.get_heart_rate_signal('right', 1)

            # Pull signal2 for both sides up-front (only if dual sensors are
            # available) so check_presence gets all four piezos.
            left2_signal = None
            right2_signal = None
            if self.sensor_count == 2:
                left2_signal = self.buffer.get_heart_rate_signal('left', 2)
                right2_signal = self.buffer.get_heart_rate_signal('right', 2)

            log = self.iteration_count % 300 == 0
            epoch = piezo_record['ts']
            time = datetime.fromtimestamp(epoch)
            if log:
                logger.debug(f'Process check - Processing piezo record @ {time.isoformat()}')

            if self.presence is None:
                self.check_presence(left1_signal, right1_signal, left2_signal, right2_signal)

            # Process left side
            if self.left_processor.present_for > self.left_processor.heart_rate_window_seconds:
                if log:
                    logger.debug(f'Presence detected for left side @ {time.isoformat()}')

                left2_signal = None
                if self.sensor_count == 2:
                    left2_signal = self.buffer.get_heart_rate_signal('left', 2)

                # Heart rate calculation
                self.left_processor.calculate_heart_rate(epoch, left1_signal, left2_signal)

                # Breath rate calculation
                if self.can_calculate_breath_rate() and self.left_processor.present_for >= self.left_processor.breath_rate_window_seconds:
                    breath_rate_signal = self.buffer.get_signal('left', self.left_processor.breath_rate_window_seconds)
                    self.left_processor.calculate_breath_rate(breath_rate_signal, epoch)

                # HRV calculation
                if self.can_calculate_hrv() and self.left_processor.present_for >= self.left_processor.hrv_window_seconds:
                    hrv_signal = self.buffer.get_signal('left', self.left_processor.hrv_window_seconds)
                    self.left_processor.calculate_hrv(hrv_signal, epoch)

            # Process right side
            if self.right_processor.present_for > self.right_processor.heart_rate_window_seconds:
                if log:
                    logger.debug(f'Presence detected for right side @ {time.isoformat()}')

                right2_signal = None
                if self.sensor_count == 2:
                    right2_signal = self.buffer.get_heart_rate_signal('right', 2)

                # Heart rate calculation
                self.right_processor.calculate_heart_rate(epoch, right1_signal, right2_signal)

                # Breath rate calculation
                if self.can_calculate_breath_rate() and self.right_processor.present_for >= self.right_processor.breath_rate_window_seconds:
                    breath_rate_signal = self.buffer.get_signal('right', self.right_processor.breath_rate_window_seconds)
                    self.right_processor.calculate_breath_rate(breath_rate_signal, epoch)

                # HRV calculation
                if self.can_calculate_hrv() and self.right_processor.present_for >= self.right_processor.hrv_window_seconds:
                    hrv_signal = self.buffer.get_signal('right', self.right_processor.hrv_window_seconds)
                    self.right_processor.calculate_hrv(hrv_signal, epoch)



