"""Capacitance delta for one side of the bed, with the no-reading sentinel masked."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from presence.cap import CapBaseline, cap_delta

BASELINE = CapBaseline(mean=(11.0, 10.0, 15.0), noise=0.05)


class CapDeltaTest(unittest.TestCase):
    def test_sums_the_three_pair_means_over_the_baseline(self):
        values = [13.0, 15.0, 11.0, 13.0, 18.0, 18.0, 1.2, 1.2]
        # pair means 14, 12, 18 against 11, 10, 15
        self.assertAlmostEqual(cap_delta(values, BASELINE), 3.0 + 2.0 + 3.0)

    def test_empty_bed_reads_near_zero(self):
        values = [11.0, 11.0, 10.0, 10.0, 15.0, 15.0, 1.2, 1.2]
        self.assertAlmostEqual(cap_delta(values, BASELINE), 0.0)

    def test_all_sentinel_is_no_reading(self):
        self.assertIsNone(cap_delta([-1.0] * 8, BASELINE))

    def test_one_dead_channel_is_scaled_out_not_counted_as_a_drop(self):
        values = [13.0, 13.0, -1.0, -1.0, 17.0, 17.0, 1.2, 1.2]
        # channels out and in rise 2 each; cen is dead, so 4 * 3 / 2
        self.assertAlmostEqual(cap_delta(values, BASELINE), 6.0)

    def test_one_sentinel_in_a_pair_uses_its_partner(self):
        values = [-1.0, 13.0, 10.0, 10.0, 15.0, 15.0, 1.2, 1.2]
        self.assertAlmostEqual(cap_delta(values, BASELINE), 2.0)

    def test_short_or_missing_values_are_no_reading(self):
        self.assertIsNone(cap_delta(None, BASELINE))
        self.assertIsNone(cap_delta([12.0, 12.0], BASELINE))

    def test_sentinel_never_leaks_into_the_delta(self):
        # Unmasked, one sentinel record on this side reads as a drop of about 40.
        values = [-1.0] * 6 + [1.2, 1.2]
        self.assertIsNone(cap_delta(values, BASELINE))

    def test_a_sentinel_in_every_pair_uses_each_partner(self):
        values = [-1.0, 13.0, 12.0, -1.0, -1.0, 18.0, 1.2, 1.2]
        # partners 13, 12, 18 against 11, 10, 15
        self.assertAlmostEqual(cap_delta(values, BASELINE), 2.0 + 2.0 + 3.0)

    def test_partial_sentinels_match_the_same_row_with_the_partner_repeated(self):
        partial = [-1.0, 13.0, 10.0, -1.0, 15.0, 15.0, 1.2, 1.2]
        whole = [13.0, 13.0, 10.0, 10.0, 15.0, 15.0, 1.2, 1.2]
        self.assertAlmostEqual(cap_delta(partial, BASELINE), cap_delta(whole, BASELINE))

    def test_two_dead_channels_scale_the_survivor_to_three(self):
        values = [-1.0, -1.0, 12.0, 12.0, -1.0, -1.0, 1.2, 1.2]
        # cen rises 2, so 2 * 3 / 1
        self.assertAlmostEqual(cap_delta(values, BASELINE), 6.0)

    def test_the_reference_pair_does_not_change_the_delta(self):
        values = [13.0, 13.0, 12.0, 12.0, 17.0, 17.0]
        with_reference = values + [-1.0, -1.0]
        self.assertAlmostEqual(cap_delta(with_reference, BASELINE), cap_delta(values, BASELINE))

    def test_a_row_of_only_the_reference_pair_is_no_reading(self):
        self.assertIsNone(cap_delta([-1.0] * 6 + [-1.0, -1.0], BASELINE))

    def test_missing_entries_are_left_out_like_sentinels(self):
        values = [None, 13.0, 10.0, 10.0, 15.0, 15.0, 1.2, 1.2]
        self.assertAlmostEqual(cap_delta(values, BASELINE), 2.0)

    def test_nan_entries_are_left_out_like_sentinels(self):
        values = [float('nan'), 13.0, 10.0, 10.0, 15.0, 15.0, 1.2, 1.2]
        self.assertAlmostEqual(cap_delta(values, BASELINE), 2.0)
        self.assertIsNone(cap_delta([float('nan')] * 6 + [1.2, 1.2], BASELINE))

    def test_integer_sentinels_are_masked(self):
        values = [-1, -1, 12, 12, 17, 17, 1, 1]
        self.assertAlmostEqual(cap_delta(values, BASELINE), (2.0 + 2.0) * 3 / 2)

    def test_a_drop_below_the_baseline_stays_negative(self):
        values = [9.0, 9.0, 8.0, 8.0, 13.0, 13.0, 1.2, 1.2]
        self.assertAlmostEqual(cap_delta(values, BASELINE), -6.0)


if __name__ == '__main__':
    unittest.main()
