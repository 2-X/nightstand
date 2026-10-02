import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.dirname(__file__))

from vitals2.artifacts import mask_artifacts
from vitals2.hr import estimate_hr
from vitals2.hrv import LEARN_SECONDS, WINDOW_SECONDS, BeatTemplate, jj_intervals, rmssd_sdnn
from vitals2_synth import FS, bcg, beat_times, breathing, noise

BPM = 62.0
JITTER_MS = 25.0


def night_segment(seconds=WINDOW_SECONDS, seed=3):
    times = beat_times(seconds, BPM, JITTER_MS, seed)
    signal = bcg(seconds, times=times) + breathing(seconds, 15) + noise(seconds, 15_000, seed) + 400_000
    return signal, np.diff(times[times < seconds - 0.3]) * 1000.0


def learned(signal):
    template = BeatTemplate.learn(signal[-int(LEARN_SECONDS * FS):], FS, 60.0 / BPM, learned_at=0)
    assert template is not None
    return template


class BeatTemplateTest(unittest.TestCase):
    def test_learns_a_unit_norm_beat_shape(self):
        signal, _ = night_segment(LEARN_SECONDS)
        template = learned(signal)
        self.assertAlmostEqual(float(np.linalg.norm(template.shape)), 1.0, places=6)
        self.assertAlmostEqual(float(template.shape.mean()), 0.0, places=6)

    def test_too_few_beats_gives_no_template(self):
        signal, _ = night_segment(10)
        self.assertIsNone(BeatTemplate.learn(signal, FS, 60.0 / BPM, learned_at=0))

    def test_goes_stale_after_the_refresh_interval(self):
        template = learned(night_segment(LEARN_SECONDS)[0])
        self.assertFalse(template.is_stale(299))
        self.assertTrue(template.is_stale(300))


class JjIntervalsTest(unittest.TestCase):
    def test_intervals_match_the_true_beats(self):
        signal, truth = night_segment()
        intervals = jj_intervals(signal, FS, learned(signal))
        kept = intervals[~np.isnan(intervals)]
        self.assertGreater(kept.size, 0.9 * truth.size)
        self.assertAlmostEqual(float(np.median(kept)), float(np.median(truth)), delta=4.0)

    def test_hrv_matches_the_true_variability(self):
        signal, truth = night_segment()
        rmssd, sdnn, coverage = rmssd_sdnn(jj_intervals(signal, FS, learned(signal)), WINDOW_SECONDS)
        true_rmssd = float(np.sqrt(np.mean(np.diff(truth) ** 2)))
        self.assertGreater(coverage, 0.9)
        self.assertAlmostEqual(rmssd, true_rmssd, delta=0.15 * true_rmssd)
        self.assertAlmostEqual(sdnn, float(np.std(truth)), delta=0.15 * float(np.std(truth)))

    def test_clipped_stretches_lower_coverage_instead_of_corrupting_hrv(self):
        signal, truth = night_segment()
        raw = np.round(signal).astype(np.int64)
        for start in range(20, WINDOW_SECONDS, 30):
            raw[int(start * FS):int((start + 12) * FS)] = 8_388_607
        cleaned, bad = mask_artifacts(raw)
        template = learned(signal)
        rmssd, _, coverage = rmssd_sdnn(jj_intervals(cleaned, FS, template, bad=bad), WINDOW_SECONDS)
        self.assertLess(coverage, 0.65)
        self.assertGreater(coverage, 0.45)
        if rmssd is not None:
            true_rmssd = float(np.sqrt(np.mean(np.diff(truth) ** 2)))
            self.assertAlmostEqual(rmssd, true_rmssd, delta=0.2 * true_rmssd)


class TrackerSeedTest(unittest.TestCase):
    def test_the_tracked_rate_seeds_the_template(self):
        signal, truth = night_segment()
        rates = [window.bpm for window in estimate_hr(signal, FS) if window.bpm is not None]
        self.assertTrue(rates)
        template = BeatTemplate.learn(signal[-int(LEARN_SECONDS * FS):], FS, 60.0 / float(np.median(rates)), learned_at=0)
        self.assertIsNotNone(template)
        rmssd, _, coverage = rmssd_sdnn(jj_intervals(signal, FS, template), WINDOW_SECONDS)
        true_rmssd = float(np.sqrt(np.mean(np.diff(truth) ** 2)))
        self.assertGreater(coverage, 0.9)
        self.assertAlmostEqual(rmssd, true_rmssd, delta=0.15 * true_rmssd)


class RmssdSdnnTest(unittest.TestCase):
    def test_uses_only_successive_kept_pairs(self):
        intervals = np.array([1000.0, 1020.0, np.nan, 800.0, 820.0, np.nan] * 60)
        rmssd, sdnn, coverage = rmssd_sdnn(intervals, 300)
        self.assertAlmostEqual(rmssd, 20.0)
        self.assertAlmostEqual(coverage, 0.728)
        self.assertAlmostEqual(sdnn, float(np.std([1000.0, 1020.0, 800.0, 820.0])))

    def test_low_coverage_reports_no_values(self):
        intervals = np.array([1000.0] * 150 + [np.nan] * 150)
        self.assertEqual(rmssd_sdnn(intervals, 300), (None, None, 0.5))

    def test_empty_input(self):
        self.assertEqual(rmssd_sdnn(np.array([]), 300), (None, None, 0.0))


if __name__ == '__main__':
    unittest.main()
