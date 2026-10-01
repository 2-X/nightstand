"""Each capacitance record format the Pod writes, read into three channels per side."""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from presence.sensors import CAPSENSE, CAPSENSE2, format_named, read_cap, unknown_cap_type


def capsense2(left, right=None):
    return {'type': 'capSense2', 'ts': 1790568000, 'version': 1,
            'left': {'values': left, 'status': 'good'},
            'right': {'values': left if right is None else right, 'status': 'good'}}


def capsense(left, right=None):
    return {'type': 'capSense', 'ts': 1790568000, 'seq': 7, 'left': left, 'right': left if right is None else right}


def counts(out, cen, inner, status='good'):
    return {'out': out, 'cen': cen, 'in': inner, 'status': status}


class Capsense2Test(unittest.TestCase):
    def test_pair_means_are_the_channels(self):
        reading = read_cap(capsense2([13.0, 15.0, 11.0, 13.0, 18.0, 18.0, 1.2, 1.2]))
        self.assertIs(reading.cap_format, CAPSENSE2)
        self.assertEqual(reading.ts, 1790568000)
        self.assertEqual(reading.left, (14.0, 12.0, 18.0))

    def test_a_sentinel_in_a_pair_uses_its_partner(self):
        self.assertEqual(read_cap(capsense2([-1.0, 13.0, 10.0, 10.0, 15.0, 15.0, 1.2, 1.2])).left, (13.0, 10.0, 15.0))

    def test_a_pair_with_no_reading_is_no_channel(self):
        self.assertEqual(read_cap(capsense2([13.0, 13.0, -1.0, -1.0, 17.0, 17.0, 1.2, 1.2])).left, (13.0, None, 17.0))

    def test_a_side_of_sentinels_is_a_reading_with_no_channels(self):
        # Stored like any reading, so the stream does not hold the previous one in its place.
        self.assertEqual(read_cap(capsense2([-1.0] * 8)).left, (None, None, None))

    def test_none_and_nan_are_missing_like_the_sentinel(self):
        self.assertEqual(read_cap(capsense2([None, 13.0, float('nan'), 10.0, 15.0, 15.0, 1.2, 1.2])).left,
                         (13.0, 10.0, 15.0))

    def test_integer_values_are_read(self):
        self.assertEqual(read_cap(capsense2([-1, -1, 12, 12, 17, 17, 1, 1])).left, (None, 12.0, 17.0))

    def test_the_reference_pair_is_never_a_channel(self):
        self.assertEqual(read_cap(capsense2([12.0] * 6)).left, (12.0, 12.0, 12.0))

    def test_a_side_of_the_wrong_shape_is_unreadable(self):
        for side in ({'values': [12.0] * 5}, {'values': 'abc'}, {}, None, {'values': ['12'] * 8},
                     {'values': [True] * 8}):
            with self.subTest(side=side):
                record = capsense2([12.0] * 8)
                record['left'] = side
                reading = read_cap(record)
                self.assertIsNone(reading.left)
                self.assertEqual(reading.right, (12.0, 12.0, 12.0))


class HugeIntegerTest(unittest.TestCase):
    def test_an_integer_too_large_for_a_float_makes_its_side_unreadable(self):
        huge = 10 ** 400
        record = capsense2([huge] + [12.0] * 7, [12.0] * 8)
        self.assertIsNone(read_cap(record).left)
        self.assertEqual(read_cap(record).right, (12.0, 12.0, 12.0))
        record = capsense(counts(huge, 381, 505), counts(1, 2, 3))
        self.assertIsNone(read_cap(record).left)
        self.assertEqual(read_cap(record).right, (1.0, 2.0, 3.0))

    def test_a_large_integer_that_fits_a_float_is_read(self):
        self.assertEqual(read_cap(capsense2([10 ** 300] * 6)).left, (1e300, 1e300, 1e300))
        self.assertEqual(read_cap(capsense(counts(10 ** 300, 1, 2))).left, (1e300, 1.0, 2.0))


class CapsenseTest(unittest.TestCase):
    def test_out_cen_and_in_are_the_channels(self):
        reading = read_cap(capsense(counts(387, 381, 505), counts(1076, 1075, 1074)))
        self.assertIs(reading.cap_format, CAPSENSE)
        self.assertEqual(reading.left, (387.0, 381.0, 505.0))
        self.assertEqual(reading.right, (1076.0, 1075.0, 1074.0))
        self.assertTrue(all(isinstance(value, float) for value in reading.left))

    def test_a_missing_or_placeholder_count_is_no_channel(self):
        self.assertEqual(read_cap(capsense({'out': 387, 'in': 505, 'status': 'good'})).left, (387.0, None, 505.0))
        self.assertEqual(read_cap(capsense(counts(-1, -32768, 505))).left, (None, None, 505.0))
        self.assertEqual(read_cap(capsense(counts(float('inf'), float('nan'), 505.5))).left, (None, None, 505.5))

    def test_a_side_not_reported_good_has_no_channels(self):
        self.assertEqual(read_cap(capsense(counts(387, 381, 505, status='fault'))).left, (None, None, None))

    def test_a_side_without_a_status_is_read(self):
        self.assertEqual(read_cap(capsense({'out': 1, 'cen': 2, 'in': 3})).left, (1.0, 2.0, 3.0))

    def test_a_side_of_the_wrong_shape_is_unreadable(self):
        for side in (None, [387, 381, 505], counts('387', 381, 505), counts(True, 381, 505)):
            with self.subTest(side=side):
                self.assertIsNone(read_cap(capsense(side, counts(1, 2, 3))).left)


class OtherRecordsTest(unittest.TestCase):
    def test_other_records_are_not_capacitance(self):
        for record in ({'type': 'piezo-dual'}, {'type': 'bedTemp'}, {}, None, 'capSense', {'type': 7}):
            with self.subTest(record=record):
                self.assertIsNone(read_cap(record))
                self.assertIsNone(unknown_cap_type(record))

    def test_capacitance_in_a_format_not_read_here_is_named(self):
        self.assertEqual(unknown_cap_type({'type': 'capSense3', 'left': {'values': [1.0] * 18}}), 'capSense3')
        self.assertEqual(unknown_cap_type({'type': 'CAPSENSE3'}), 'CAPSENSE3')
        self.assertIsNone(read_cap({'type': 'capSense3'}))

    def test_other_spellings_of_capacitance_are_named(self):
        for kind in ('cap_sense', 'cap-sense2', 'Capacitance', 'capacitive', 'capsense4'):
            with self.subTest(kind=kind):
                self.assertEqual(unknown_cap_type({'type': kind}), kind)

    def test_types_that_only_contain_cap_are_not_capacitance(self):
        for kind in ('escape', 'capture', 'capital', 'landscape', 'bedTemp2', 'log', 'cape', 'capped', 'cap'):
            with self.subTest(kind=kind):
                self.assertIsNone(unknown_cap_type({'type': kind}))

    def test_known_formats_are_not_unknown(self):
        self.assertIsNone(unknown_cap_type(capsense2([12.0] * 8)))
        self.assertIsNone(unknown_cap_type(capsense(counts(1, 2, 3))))

    def test_formats_by_name(self):
        self.assertIs(format_named('capSense2'), CAPSENSE2)
        self.assertIs(format_named('capSense'), CAPSENSE)
        self.assertIsNone(format_named('capSense3'))
        self.assertIsNone(format_named(None))

    def test_only_capsense2_is_validated_and_its_unit_is_one(self):
        self.assertTrue(CAPSENSE2.validated)
        self.assertEqual(CAPSENSE2.unit, 1.0)
        self.assertFalse(CAPSENSE.validated)
        self.assertTrue(math.isfinite(CAPSENSE.unit) and CAPSENSE.unit > 1)


if __name__ == '__main__':
    unittest.main()
