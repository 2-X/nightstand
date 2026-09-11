import os
import sys
import unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from vital_quality import fresh_metric, has_contiguous_window


class VitalQualityTest(unittest.TestCase):
    def test_missing_and_old_estimates_are_not_zero_or_fresh(self):
        for value, at in ((0, 100), (float('nan'), 100), (80, None), (80, 101), (80, 9)):
            self.assertIsNone(fresh_metric(value, at, 100, 90))
        self.assertEqual(fresh_metric(80, 10, 100, 90), 80)

    def test_window_rejects_gaps_duplicates_wrong_sampling_and_short_buffers(self):
        rows = [{'ts': n, 'freq': 500, 'left1': [0]*500, 'right1': [1]*500} for n in range(300)]
        self.assertTrue(has_contiguous_window(rows, 300))
        self.assertFalse(has_contiguous_window(rows[:-1], 300))
        rows[100]['ts'] = rows[99]['ts']
        self.assertFalse(has_contiguous_window(rows, 300))
        rows[100]['ts'] = 100
        rows[100]['freq'] = 250
        self.assertFalse(has_contiguous_window(rows, 300))


if __name__ == '__main__':
    unittest.main()
