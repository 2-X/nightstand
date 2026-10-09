"""Detector thresholds come from each side's learned occupied rise, bounded by
the measured empty-bed noise, and the whole-bed gate from the learned floor."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from presence.cap import CapBaseline
from presence.detector import OFFSET_LIMIT, SideParams
from presence.params import (
    DEFAULT_PIEZO_FLOOR, baselines_from_calibration, learned_levels, params_from_calibration, piezo_floor,
    side_params,
)
from presence.sensors import CAPSENSE, CAPSENSE2


def cap_payload(side, means=(11.0, 10.0, 15.0), **extra):
    payload = {f'{side}_{channel}': {'mean': mean, 'std': 1} for channel, mean in zip(('out', 'cen', 'in'), means)}
    payload.update(extra)
    payload.setdefault('provenance', {'format': 'capSense2', 'normalizationVersion': 1})
    return payload


def profiles(left=None, right=None, cap_format=CAPSENSE2):
    base = {
        'left': {'cap': cap_payload('left'), 'cap_occupied': None, 'piezo_floors': []},
        'right': {'cap': cap_payload('right'), 'cap_occupied': None, 'piezo_floors': []},
    }
    base['left'].update(left or {})
    base['right'].update(right or {})
    for entry in base.values():
        if isinstance(entry['cap'], dict) and 'provenance' in entry['cap']:
            entry['cap']['provenance']['format'] = cap_format.name
        if isinstance(entry['cap_occupied'], dict):
            entry['cap_occupied'].setdefault('provenance', {'format': cap_format.name, 'normalizationVersion': 1})
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

    def test_malformed_entries_read_as_missing_rather_than_raising(self):
        self.assertIsNone(params_from_calibration({'left': 5, 'right': profiles()['right']}))
        self.assertIsNone(params_from_calibration(['left', 'right']))
        self.assertIsNone(params_from_calibration(profiles(left={'cap': ['left_out']})))
        params = params_from_calibration(profiles(left={'piezo_floors': 5}, right={'piezo_floors': 'x'}))
        self.assertEqual(params.piezo_floor, {'left': DEFAULT_PIEZO_FLOOR, 'right': DEFAULT_PIEZO_FLOOR})

    def test_numbers_too_large_for_a_float_read_as_missing(self):
        huge = 10 ** 400
        self.assertIsNone(params_from_calibration(profiles(left={'cap': cap_payload('left', (huge, 10.0, 15.0))})))
        self.assertEqual(piezo_floor([huge]), DEFAULT_PIEZO_FLOOR)
        params = params_from_calibration(profiles(
            left={'cap_occupied': {'level': huge}, 'cap': cap_payload('left', delta_noise=huge), 'piezo_floors': [huge]},
        ))
        self.assertEqual(params.left, SideParams(enter_delta=4.0, exit_delta=2.0))
        self.assertEqual(params.piezo_floor['left'], DEFAULT_PIEZO_FLOOR)

    def test_bool_channel_means_are_not_numbers(self):
        self.assertIsNone(params_from_calibration(profiles(left={'cap': cap_payload('left', (True, 10.0, 15.0))})))


class FormatUnitsTest(unittest.TestCase):
    def test_capsense2_is_what_it_was(self):
        params = side_params(None, 0.05)
        self.assertEqual(params, SideParams(enter_delta=4.0, exit_delta=2.0))
        self.assertEqual(params.offset_limit, OFFSET_LIMIT)
        self.assertEqual(side_params(21.0, 0.05, unit=CAPSENSE2.unit), side_params(21.0, 0.05))

    def test_capsense_starts_at_its_unit(self):
        params = side_params(None, 2.0, unit=CAPSENSE.unit)
        self.assertEqual((params.enter_delta, params.exit_delta, params.offset_limit), (300.0, 150.0, 225.0))

    def test_capsense_follows_the_learned_level_within_its_bounds(self):
        self.assertAlmostEqual(side_params(1000.0, 2.0, unit=CAPSENSE.unit).enter_delta, 400.0)
        self.assertEqual(side_params(3000.0, 2.0, unit=CAPSENSE.unit).enter_delta, 750.0)
        self.assertEqual(side_params(200.0, 2.0, unit=CAPSENSE.unit).enter_delta, 225.0)
        self.assertEqual(side_params(1000.0, 80.0, unit=CAPSENSE.unit).enter_delta, 480.0)

    def test_the_format_reaches_both_sides(self):
        params = params_from_calibration(profiles(cap_format=CAPSENSE), CAPSENSE)
        self.assertEqual(params.left.enter_delta, 300.0)
        self.assertEqual(params.right.offset_limit, 225.0)
        self.assertEqual(params_from_calibration(profiles()), params_from_calibration(profiles(), CAPSENSE2))

    def test_learned_levels_need_both_sides(self):
        self.assertFalse(learned_levels(profiles()))
        learned = profiles(left={'cap_occupied': {'level': 900.0}})
        self.assertFalse(learned_levels(learned))
        learned['right']['cap_occupied'] = {'level': 450.0, 'provenance': {'format': 'capSense2', 'normalizationVersion': 1}}
        self.assertTrue(learned_levels(learned))
        learned['right']['cap_occupied'] = {'level': -1}
        self.assertFalse(learned_levels(learned))
        self.assertFalse(learned_levels(None))


class ProvenanceParamsTest(unittest.TestCase):
    def tagged(self, name='capSense2', version=1):
        result = profiles()
        for side in ('left', 'right'):
            result[side]['cap']['provenance'] = {'format': name, 'normalizationVersion': version}
        return result

    def test_untagged_baselines_are_nightstand_calibrations(self):
        unknown = profiles()
        for entry in unknown.values():
            entry['cap'].pop('provenance')
        self.assertIsNotNone(params_from_calibration(unknown, CAPSENSE2))
        self.assertEqual(baselines_from_calibration(unknown),
                         {side: CapBaseline(mean=(11.0, 10.0, 15.0), noise=0.0) for side in ('left', 'right')})

    def test_explicitly_unknown_imports_are_not_used(self):
        unknown = self.tagged(name='unknown', version=None)
        self.assertIsNone(params_from_calibration(unknown, CAPSENSE2))
        self.assertIsNone(baselines_from_calibration(unknown))

    def test_recalibrating_one_side_keeps_the_other_untagged_baseline(self):
        upgraded = self.tagged()
        upgraded['right']['cap'].pop('provenance')
        self.assertEqual(baselines_from_calibration(upgraded, CAPSENSE2),
                         {side: CapBaseline(mean=(11.0, 10.0, 15.0), noise=0.0) for side in ('left', 'right')})
        self.assertIsNotNone(params_from_calibration(upgraded, CAPSENSE2))

    def test_matching_formats_work_and_mismatches_are_rejected(self):
        self.assertIsNotNone(params_from_calibration(self.tagged(), CAPSENSE2))
        self.assertIsNone(params_from_calibration(self.tagged(), CAPSENSE))
        self.assertIsNone(params_from_calibration(self.tagged(version=2), CAPSENSE2))
        self.assertIsNone(params_from_calibration(self.tagged(version=True), CAPSENSE2))

    def test_occupied_levels_with_wrong_units_are_not_reused(self):
        result = self.tagged()
        for side in ('left', 'right'):
            result[side]['cap_occupied'] = {'level': 900, 'provenance': {'format': 'capSense', 'normalizationVersion': 1}}
        self.assertEqual(params_from_calibration(result, CAPSENSE2).left.enter_delta, 4)
        self.assertFalse(learned_levels(result, CAPSENSE2))


if __name__ == '__main__':
    unittest.main()
