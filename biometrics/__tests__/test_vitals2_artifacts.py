import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from vitals2 import gates
from vitals2.artifacts import MAX_SHORT_GAP, SENTINEL, mask_artifacts


class MaskArtifactsTest(unittest.TestCase):
    def test_short_dropouts_are_interpolated_and_kept(self):
        samples = np.array([100, 200, SENTINEL, SENTINEL, 500, 600], dtype=np.int32)
        cleaned, bad = mask_artifacts(samples)
        np.testing.assert_allclose(cleaned, [100, 200, 300, 400, 500, 600])
        self.assertFalse(bad.any())

    def test_long_dropouts_are_marked_bad(self):
        samples = np.full(40, 1000, dtype=np.int64)
        samples[5:5 + MAX_SHORT_GAP + 1] = SENTINEL
        cleaned, bad = mask_artifacts(samples)
        self.assertTrue(bad[5:5 + MAX_SHORT_GAP + 1].all())
        self.assertEqual(int(bad.sum()), MAX_SHORT_GAP + 1)
        np.testing.assert_allclose(cleaned, 1000)

    def test_rail_clipping_is_marked_bad_but_left_in_place(self):
        samples = np.array([0, 8_388_607, 8_388_607, -8_388_608, 10], dtype=np.int32)
        cleaned, bad = mask_artifacts(samples)
        self.assertEqual(bad.tolist(), [False, True, True, True, False])
        self.assertEqual(cleaned[1], 8_388_607)

    def test_wraparound_garbage_is_treated_as_a_dropout(self):
        samples = np.array([10, -2_146_959_111, 30], dtype=np.int64)
        cleaned, bad = mask_artifacts(samples)
        np.testing.assert_allclose(cleaned, [10, 20, 30])
        self.assertFalse(bad.any())

    def test_all_missing_is_all_bad(self):
        cleaned, bad = mask_artifacts(np.full(8, SENTINEL, dtype=np.int64))
        self.assertTrue(bad.all())
        np.testing.assert_allclose(cleaned, 0)


class GatesTest(unittest.TestCase):
    def test_gates_are_the_agreed_values(self):
        self.assertEqual(
            (gates.HR_MIN_QUALITY, gates.HR_RANGE, gates.HRV_MIN_COVERAGE, gates.RESP_MIN_QUALITY, gates.RESP_RANGE),
            (0.6, (35, 140), 0.6, 0.5, (6, 30)),
        )
        self.assertEqual((gates.HR_MIN_SUPPORT, gates.HR_MIN_EVIDENCE, gates.HR_MAX_OCTAVE, gates.HR_MAX_MOTION),
                         (0.4, 0.25, 0.3, 0.2))

    def test_the_suite_runs_on_the_real_scipy(self):
        import scipy.signal
        self.assertTrue(hasattr(scipy.signal, 'sosfiltfilt'))


if __name__ == '__main__':
    unittest.main()
