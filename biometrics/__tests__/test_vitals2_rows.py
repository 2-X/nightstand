import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from vitals2.gates import HR_MAX_MOTION
from vitals2.rows import HrvEstimate, WindowEstimate, minute_row, round_half_up

MINUTE = 1_790_600_400


def windows(values, quality=0.8, usable=True, motion=0.0):
    return [WindowEstimate(MINUTE + 5 * index, value, quality, usable, motion) for index, value in enumerate(values)]


class MinuteRowTest(unittest.TestCase):
    def test_medians_of_passing_windows_fill_new_and_legacy_columns(self):
        row = minute_row('left', MINUTE, windows([61.2, 62.0, 62.4, 62.8, 150.0]),
                         windows([15.8, 16.2, 16.4]), HrvEstimate(MINUTE + 60, 41.26, 38.74, 0.812))
        self.assertEqual(row, {
            'side': 'left', 'timestamp': MINUTE,
            'heart_rate': 62, 'hrv': 39, 'breathing_rate': 16,
            'hr_quality': 0.8, 'rmssd': 41.3, 'sdnn': 38.7, 'hrv_coverage': 0.81,
            'resp_rate': 16.2, 'resp_quality': 0.8, 'estimator': 2,
        })

    def test_rounds_instead_of_flooring(self):
        row = minute_row('left', MINUTE, windows([63.4, 63.5, 63.7, 63.9]), [], None)
        self.assertEqual(row['heart_rate'], 64)
        self.assertEqual(round_half_up(2.5), 3)
        self.assertEqual(round_half_up(0.125, 2), 0.13)

    def test_no_passing_heart_rate_means_no_row(self):
        self.assertIsNone(minute_row('left', MINUTE, windows([62.0] * 4, quality=0.55), windows([15.0]), None))
        self.assertIsNone(minute_row('left', MINUTE, windows([30.0, 141.0, 30.0, 141.0]), [], None))
        self.assertIsNone(minute_row('left', MINUTE, windows([62.0] * 4, usable=False), [], None))

    def test_too_few_windows_means_no_row(self):
        self.assertIsNone(minute_row('left', MINUTE, windows([62.0] * 3), [], None))

    def test_scattered_windows_mean_no_row(self):
        self.assertIsNone(minute_row('left', MINUTE, windows([50.0, 60.0, 70.0, 80.0, 90.0]), [], None))

    def test_a_minute_with_too_much_movement_has_no_row(self):
        moving = windows([62.0] * 9) + windows([None] * 3, motion=1.0)
        self.assertIsNone(minute_row('left', MINUTE, moving, [], None))
        below = 0.9 * HR_MAX_MOTION
        within = windows([62.0] * 10, motion=below) + windows([None] * 2, motion=below)
        self.assertEqual(minute_row('left', MINUTE, within, [], None)['heart_rate'], 62)

    def test_a_minute_whose_windows_each_meet_the_movement_limit_keeps_its_row(self):
        at_limit = windows([62.0] * 12, motion=HR_MAX_MOTION)
        self.assertEqual(minute_row('left', MINUTE, at_limit, [], None)['heart_rate'], 62)
        over = windows([62.0] * 11, motion=HR_MAX_MOTION) + windows([62.0], motion=HR_MAX_MOTION + 0.1)
        self.assertIsNone(minute_row('left', MINUTE, over, [], None))

    def test_movement_counts_every_window_of_the_minute_not_only_passing_ones(self):
        moving_rejects = windows([62.0] * 6) + windows([None] * 6, quality=0.1, motion=0.5)
        self.assertIsNone(minute_row('left', MINUTE, moving_rejects, [], None))
        self.assertIsNotNone(minute_row('left', MINUTE, windows([62.0] * 6) + windows([None] * 6, quality=0.1), [], None))

    def test_hrv_never_supplies_a_rate(self):
        scattered = windows([50.0, 60.0, 70.0, 80.0, 90.0])
        self.assertIsNone(minute_row('left', MINUTE, scattered, [], HrvEstimate(MINUTE + 60, 35.0, 30.0, 0.7)))
        self.assertIsNone(minute_row('left', MINUTE, [], [], HrvEstimate(MINUTE + 60, 35.0, 30.0, 0.7)))

    def test_heart_rates_above_the_old_ceiling_are_kept(self):
        self.assertEqual(minute_row('right', MINUTE, windows([104.0] * 4), [], None)['heart_rate'], 104)

    def test_failing_breathing_and_hrv_read_as_missing(self):
        row = minute_row('left', MINUTE, windows([60.0] * 4), windows([15.0], quality=0.4) + windows([None]),
                         HrvEstimate(MINUTE + 60, None, None, 0.42))
        self.assertEqual((row['resp_rate'], row['resp_quality'], row['breathing_rate']), (None, None, 0))
        self.assertEqual((row['rmssd'], row['sdnn'], row['hrv'], row['hrv_coverage']), (None, None, 0, 0.42))

    def test_sdnn_outside_the_legacy_band_leaves_the_legacy_column_at_zero(self):
        row = minute_row('left', MINUTE, windows([60.0] * 4), [], HrvEstimate(MINUTE + 60, 250.0, 230.0, 0.9))
        self.assertEqual((row['hrv'], row['sdnn']), (0, 230.0))

    def test_breathing_outside_the_gate_is_dropped(self):
        row = minute_row('left', MINUTE, windows([60.0] * 4), windows([4.0, 33.0]), None)
        self.assertIsNone(row['resp_rate'])

    def test_windows_without_a_rate_never_count_whatever_their_quality(self):
        confident = [WindowEstimate(MINUTE + 5 * index, None, 0.95) for index in range(8)]
        self.assertIsNone(minute_row('left', MINUTE, confident + windows([62.0] * 3), [], None))
        row = minute_row('left', MINUTE, confident + windows([62.0] * 4, quality=0.7), [], None)
        self.assertEqual((row['heart_rate'], row['hr_quality']), (62, 0.7))

    def test_a_breathing_estimate_without_a_rate_is_no_rate(self):
        disagreeing = [WindowEstimate(MINUTE + 5 * index, None, 0.9) for index in range(4)]
        row = minute_row('left', MINUTE, windows([60.0] * 4), disagreeing, None)
        self.assertEqual((row['resp_rate'], row['resp_quality'], row['breathing_rate']), (None, None, 0))
        row = minute_row('left', MINUTE, windows([60.0] * 4), disagreeing + windows([14.0, 15.0], quality=0.6), None)
        self.assertEqual((row['resp_rate'], row['resp_quality']), (14.5, 0.6))


if __name__ == '__main__':
    unittest.main()
