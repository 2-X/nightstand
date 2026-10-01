"""What piezo records say about themselves, and whether they come once a second."""
import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from presence.piezo import CADENCE_RECORDS, CadenceCheck, PiezoLayout, one_per_second_share, piezo_layout

SECOND = np.zeros(500, dtype=np.int32)


class PiezoLayoutTest(unittest.TestCase):
    def test_a_pod_5_record(self):
        record = {'type': 'piezo-dual', 'ts': 1, 'freq': 500, 'adc': 65, 'gain': 400,
                  'left1': SECOND.tobytes(), 'right1': SECOND.tobytes()}
        layout = piezo_layout(record)
        self.assertEqual(layout, PiezoLayout(freq=500, samples=500, sensors_per_side=1))
        self.assertEqual(layout.record_seconds(), 1.0)

    def test_a_record_with_two_sensors_a_side_after_decoding(self):
        record = {'type': 'piezo-dual', 'freq': 1000, 'left1': np.zeros(1000), 'left2': np.zeros(1000),
                  'right1': np.zeros(1000), 'right2': np.zeros(1000)}
        self.assertEqual(piezo_layout(record), PiezoLayout(freq=1000, samples=1000, sensors_per_side=2))

    def test_an_unusable_rate_is_unknown(self):
        for freq in (None, 0, -500, 'fast', True, float('nan'), float('inf')):
            with self.subTest(freq=freq):
                layout = piezo_layout({'type': 'piezo-dual', 'freq': freq, 'left1': SECOND.tobytes()})
                self.assertIsNone(layout.freq)
                self.assertIsNone(layout.record_seconds())

    def test_other_records_have_no_layout(self):
        self.assertIsNone(piezo_layout({'type': 'capSense2'}))
        self.assertIsNone(piezo_layout({'type': 'piezo-dual', 'left1': 'abc'}))
        self.assertIsNone(piezo_layout(None))


class CadenceTest(unittest.TestCase):
    def test_one_record_a_second(self):
        self.assertEqual(one_per_second_share(range(1000, 1300)), 1.0)

    def test_repeats_and_long_gaps_do_not_count(self):
        seconds = list(range(0, 100)) + list(range(50, 60)) + list(range(5000, 5100))
        self.assertEqual(one_per_second_share(seconds), 1.0)

    def test_two_seconds_apart(self):
        self.assertEqual(one_per_second_share(range(0, 600, 2)), 0.0)

    def test_too_few_records_say_nothing(self):
        self.assertEqual(one_per_second_share([5]), 0.0)
        self.assertEqual(one_per_second_share([]), 0.0)

    def test_the_live_check_waits_for_enough_records(self):
        check = CadenceCheck()
        for second in range(CADENCE_RECORDS - 1):
            check.add(second)
        self.assertIsNone(check.ok())
        check.add(CADENCE_RECORDS - 1)
        self.assertTrue(check.ok())

    def test_the_live_check_sees_a_slow_stream(self):
        check = CadenceCheck()
        for second in range(0, 2 * CADENCE_RECORDS, 2):
            check.add(second)
        self.assertFalse(check.ok())

    def test_the_live_check_ignores_unusable_stamps(self):
        check = CadenceCheck(records=3)
        for ts in (float('nan'), float('inf'), None, 'x', 10 ** 30, 1, 2, 3):
            check.add(ts)
        self.assertTrue(check.ok())


if __name__ == '__main__':
    unittest.main()
