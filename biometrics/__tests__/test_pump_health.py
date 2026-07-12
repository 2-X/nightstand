"""Tests for pump-stall detection (service_health.update_pump_health).

Root cause: the hub water-temperature sensor sits next to the TEC
(heating/cooling element), not in the bed. If the pump stalls while the TEC
keeps drawing current, the sensor reads stagnant water next to a powered
heating element, a runaway number, not bed temperature. Reported by a
free-sleep user (side ran to 102F overnight against an 84F setpoint) and
documented independently by sleepypod/core's ADR 0022.

Run locally (needs cbor2, not part of the node CI):
    python3 -m pytest biometrics/__tests__/test_pump_health.py -v
(also runs under plain unittest: python3 -m unittest discover ...)
"""
import unittest

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import logging
import get_logger as _gl

_gl._get_file_handler = lambda data_folder_path, name: logging.NullHandler()

from get_logger import get_logger, LOGGER_NAMES

for _name in LOGGER_NAMES:
    get_logger(_name)

import service_health


def _frame(left_rpm=1950, left_current=12.0, left_water=True,
           right_rpm=2000, right_current=8.0, right_water=True):
    return {
        'type': 'frzHealth',
        'ts': 1783654226,
        'left': {'tec': {'current': left_current}, 'pump': {'mode': 'pwm', 'rpm': left_rpm, 'water': left_water}},
        'right': {'tec': {'current': right_current}, 'pump': {'mode': 'pwm', 'rpm': right_rpm, 'water': right_water}},
    }


class TestPumpHealth(unittest.TestCase):
    def setUp(self):
        # Fresh dwell-counter state per test, and capture update_health calls
        # instead of hitting the network.
        service_health._pump_state = {
            'left': {'consecutive_stall': 0, 'consecutive_healthy': 0, 'is_stalled': False, 'reported_healthy': False},
            'right': {'consecutive_stall': 0, 'consecutive_healthy': 0, 'is_stalled': False, 'reported_healthy': False},
        }
        self.calls = []
        self._orig_update_health = service_health.update_health
        service_health.update_health = lambda job_key, status, message='': self.calls.append((job_key, status, message))

    def tearDown(self):
        service_health.update_health = self._orig_update_health

    def test_healthy_pump_reports_healthy_once(self):
        for _ in range(3):
            service_health.update_pump_health(_frame())
        # Only the first confirmed-healthy frame should report; no repeats.
        self.assertEqual(self.calls, [('pumpLeft', 'healthy', ''), ('pumpRight', 'healthy', '')])

    def test_pump_off_with_tec_idle_does_not_alert(self):
        # Side is off: TEC isn't drawing current, pump is idle at 0 RPM.
        # This must not be treated as a stall.
        for _ in range(10):
            service_health.update_pump_health(_frame(left_rpm=0, left_current=0.0, left_water=False))
        left_calls = [c for c in self.calls if c[0] == 'pumpLeft']
        self.assertEqual(left_calls, [])

    def test_sustained_stall_trips_after_dwell(self):
        # TEC actively driving but pump stalled (near-zero RPM), matches the
        # reported failure mode. Should not trip before the dwell window.
        for _ in range(service_health._PUMP_STALL_DWELL_FRAMES - 1):
            service_health.update_pump_health(_frame(left_rpm=5, left_current=12.0, left_water=False))
        self.assertEqual([c for c in self.calls if c[0] == 'pumpLeft'], [])

        service_health.update_pump_health(_frame(left_rpm=5, left_current=12.0, left_water=False))
        left_calls = [c for c in self.calls if c[0] == 'pumpLeft']
        self.assertEqual(len(left_calls), 1)
        self.assertEqual(left_calls[0][1], 'failed')
        self.assertIn('stall', left_calls[0][2].lower())

    def test_single_noisy_frame_does_not_trip(self):
        service_health.update_pump_health(_frame())
        service_health.update_pump_health(_frame(left_rpm=0, left_current=12.0, left_water=False))
        service_health.update_pump_health(_frame())
        left_calls = [c for c in self.calls if c[0] == 'pumpLeft' and c[1] == 'failed']
        self.assertEqual(left_calls, [])

    def test_recovers_after_dwell(self):
        for _ in range(service_health._PUMP_STALL_DWELL_FRAMES):
            service_health.update_pump_health(_frame(left_rpm=5, left_current=12.0, left_water=False))
        self.calls.clear()

        for _ in range(service_health._PUMP_RECOVERY_DWELL_FRAMES):
            service_health.update_pump_health(_frame())
        left_calls = [c for c in self.calls if c[0] == 'pumpLeft']
        self.assertEqual(len(left_calls), 1)
        self.assertEqual(left_calls[0][1], 'healthy')

    def test_missing_fields_are_skipped_not_crashed(self):
        service_health.update_pump_health({'type': 'frzHealth', 'ts': 1, 'left': {}, 'right': {}})
        self.assertEqual(self.calls, [])

    def test_stalled_latch_clears_once_side_goes_fully_quiet(self):
        # Trip a stall, then simulate the side powering off: frzHealth stops
        # carrying live TEC/pump numbers for it (empty dict), same shape as
        # test_missing_fields_are_skipped_not_crashed. A latch that trips
        # right before power-off must still be able to self-clear instead of
        # staying 'failed' forever with no more qualifying frames to receive.
        for _ in range(service_health._PUMP_STALL_DWELL_FRAMES):
            service_health.update_pump_health(_frame(left_rpm=5, left_current=12.0, left_water=False))
        self.assertTrue(service_health._pump_state['left']['is_stalled'])
        self.calls.clear()

        for _ in range(service_health._PUMP_RECOVERY_DWELL_FRAMES):
            service_health.update_pump_health({'type': 'frzHealth', 'ts': 1, 'left': {}, 'right': {}})
        left_calls = [c for c in self.calls if c[0] == 'pumpLeft']
        self.assertEqual(len(left_calls), 1)
        self.assertEqual(left_calls[0][1], 'healthy')
        self.assertFalse(service_health._pump_state['left']['is_stalled'])


if __name__ == '__main__':
    unittest.main()
