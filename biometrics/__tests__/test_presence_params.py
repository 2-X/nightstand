"""Detector thresholds come from each side's learned occupied rise, bounded by
the measured empty-bed noise, and the whole-bed gate from the learned floor."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from presence.cap import CapBaseline
from presence.detector import SideParams
from presence.params import (
    DEFAULT_PIEZO_FLOOR, baselines_from_calibration, params_from_calibration, piezo_floor, side_params,
)


def cap_payload(side, means=(11.0, 10.0, 15.0), **extra):
    payload = {f'{side}_{channel}': {'mean': mean, 'std': 1} for channel, mean in zip(('out', 'cen', 'in'), means)}
    payload.update(extra)
    return payload


def profiles(left=None, right=None):
    base = {
        'left': {'cap': cap_payload('left'), 'cap_occupied': None, 'piezo_floors': []},
        'right': {'cap': cap_payload('right'), 'cap_occupied': None, 'piezo_floors': []},
    }
    base['left'].update(left or {})
    base['right'].update(right or {})
    return base


class SideParamsTest(unittest.TestCase):
    def test_default_levels_before_anything_is_learned(self):
        self.assertEqual(side_params(None, 0.05), SideParams(enter_delta=4.0, exit_delta=2.0))

    def test_scaled_from_the_occupied_rise(self):
        heavy = side_params(21.0, 0.05)
        self.assertAlmostEqual(heavy.enter_delta, 8.4)
        self.assertAlmostEqual(heavy.exit_delta, 4.2)
        light = side_params(10.0, 0.05)
        self.assertAlmostEqual(light.enter_delta, 4.0)
        self.assertAlmostEqual(light.exit_delta, 2.0)

    def test_never_below_partner_spikes_or_the_noise(self):
        self.assertEqual(side_params(5.0, 0.05).enter_delta, 3.0)
        self.assertAlmostEqual(side_params(10.0, 0.8).enter_delta, 4.8)

    def test_never_above_the_ceiling(self):
        self.assertEqual(side_params(40.0, 0.05).enter_delta, 10.0)
        self.assertEqual(side_params(None, 5.0).enter_delta, 10.0)

    def test_dwell_times_are_the_validated_ones(self):
        params = side_params(None, 0.0)
        self.assertEqual((params.enter_seconds, params.exit_seconds), (20, 60))


class PiezoFloorTest(unittest.TestCase):
    def test_median_of_recent_floors(self):
        self.assertEqual(piezo_floor([36_152.0, 81_566.0, 66_293.0]), 66_293.0)

    def test_default_when_nothing_is_usable(self):
        self.assertEqual(piezo_floor([]), DEFAULT_PIEZO_FLOOR)
        self.assertEqual(piezo_floor(None), DEFAULT_PIEZO_FLOOR)
        self.assertEqual(piezo_floor([0, -5, float('nan'), 'x', True]), DEFAULT_PIEZO_FLOOR)

    def test_bounded(self):
        self.assertEqual(piezo_floor([5_000.0]), 30_000.0)
        self.assertEqual(piezo_floor([900_000.0]), 150_000.0)


class FromCalibrationTest(unittest.TestCase):
    def test_none_without_a_capacitance_baseline_on_either_side(self):
        self.assertIsNone(params_from_calibration(profiles(left={'cap': None})))
        self.assertIsNone(params_from_calibration(profiles(right={'cap': {'right_out': {'mean': 1}}})))
        self.assertIsNone(params_from_calibration({}))
        self.assertIsNone(params_from_calibration(None))
        self.assertIsNone(baselines_from_calibration(profiles(left={'cap': None})))

    def test_fresh_calibration_gives_the_default_levels_and_gate(self):
        params = params_from_calibration(profiles())
        self.assertEqual(params.left, SideParams(enter_delta=4.0, exit_delta=2.0))
        self.assertEqual(params.right, SideParams(enter_delta=4.0, exit_delta=2.0))
        self.assertEqual(params.piezo_floor, {'left': DEFAULT_PIEZO_FLOOR, 'right': DEFAULT_PIEZO_FLOOR})

    def test_learned_values_are_used_per_side(self):
        params = params_from_calibration(profiles(
            left={'cap_occupied': {'level': 21.0}, 'piezo_floors': [36_152.0, 81_566.0, 66_293.0]},
            right={'cap_occupied': {'level': 10.0}, 'piezo_floors': [69_448.0]},
        ))
        self.assertAlmostEqual(params.left.enter_delta, 8.4)
        self.assertAlmostEqual(params.right.enter_delta, 4.0)
        self.assertEqual(params.piezo_floor, {'left': 66_293.0, 'right': 69_448.0})

    def test_noise_comes_from_the_calibrated_payload(self):
        params = params_from_calibration(profiles(left={'cap': cap_payload('left', delta_noise=0.9)}))
        self.assertAlmostEqual(params.left.enter_delta, 5.4)
        self.assertEqual(params.right.enter_delta, 4.0)

    def test_bad_learned_values_fall_back_to_defaults(self):
        params = params_from_calibration(profiles(
            left={'cap_occupied': {'level': 'x'}, 'cap': cap_payload('left', delta_noise=float('nan'))},
            right={'cap_occupied': {'level': -3}},
        ))
        self.assertEqual(params.left.enter_delta, 4.0)
        self.assertEqual(params.right.enter_delta, 4.0)

    def test_baselines_carry_channel_means_and_noise(self):
        baselines = baselines_from_calibration(profiles(left={'cap': cap_payload('left', (11.3, 9.9, 14.8), delta_noise=0.05)}))
        self.assertEqual(baselines['left'], CapBaseline(mean=(11.3, 9.9, 14.8), noise=0.05))
        self.assertEqual(baselines['right'], CapBaseline(mean=(11.0, 10.0, 15.0), noise=0.0))


if __name__ == '__main__':
    unittest.main()
