import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.dirname(__file__))

from vitals2.attribution import attribute
from vitals2.hr import HrWindow, estimate_hr
from vitals2_synth import FS, bcg, beat_times, breathing, noise, pink_noise

SECONDS = 300


def background(seed):
    return noise(SECONDS, seed=seed) + pink_noise(SECONDS, 25_000, seed + 1)


def sides(left, right):
    """Both sides' windows, paired by start, with each side's keep decisions."""
    pairs = list(zip(estimate_hr(left, FS), estimate_hr(right, FS)))
    return pairs, [attribute(mine, theirs) for mine, theirs in pairs]


class AttributeTest(unittest.TestCase):
    def test_one_heart_on_both_sensors_stays_with_the_stronger_side(self):
        heart = bcg(SECONDS, 64, jitter_ms=30, seed=1, modulation=0.3)
        left = heart + breathing(SECONDS, 14) + background(2)
        right = 0.35 * heart + breathing(SECONDS, 14, 300_000) + background(12)
        pairs, decisions = sides(left, right)
        self.assertGreater(decisions.count((True, False)), 0.85 * len(pairs))
        self.assertNotIn((False, True), decisions)
        swapped = [attribute(theirs, mine) for mine, theirs in pairs]
        self.assertGreater(swapped.count((False, True)), 0.85 * len(pairs))

    def test_the_empty_side_keeps_few_of_the_partner_windows(self):
        heart = bcg(SECONDS, 58, jitter_ms=30, seed=3, modulation=0.3)
        pairs, decisions = sides(heart + breathing(SECONDS, 13) + background(4), 0.35 * heart + background(14))
        reported = [keep for (_, empty), (_, keep) in zip(pairs, decisions) if empty.bpm is not None]
        self.assertGreater(len(reported), 0.5 * len(pairs))
        self.assertLess(sum(reported), 0.1 * len(pairs))

    def test_two_hearts_at_different_rates_are_both_kept(self):
        left = bcg(SECONDS, 62, jitter_ms=30, seed=1) + background(2)
        right = bcg(SECONDS, 76, jitter_ms=30, seed=5) + background(12)
        _, decisions = sides(left, right)
        self.assertEqual(set(decisions), {(True, True)})

    def test_two_hearts_at_the_same_rate_out_of_phase_are_both_kept(self):
        onsets = beat_times(SECONDS, 66, jitter_ms=20, seed=6)
        left = bcg(SECONDS, times=onsets) + background(2)
        right = bcg(SECONDS, times=onsets + 0.4) + background(12)
        _, decisions = sides(left, right)
        self.assertGreater(decisions.count((True, True)), 0.95 * len(decisions))

    def test_two_hearts_at_nearly_the_same_rate_keep_most_of_the_weaker_ones(self):
        left = bcg(SECONDS, 66, jitter_ms=30, seed=7, modulation=0.3) + breathing(SECONDS, 14) + background(2)
        right = (0.5 * bcg(SECONDS, 66.5, jitter_ms=30, seed=8, modulation=0.3, per_minute=12)
                 + breathing(SECONDS, 12, 500_000) + background(12))
        pairs, decisions = sides(left, right)
        self.assertTrue(all(keep for keep, _ in decisions))
        weaker = [keep for (_, mine), (_, keep) in zip(pairs, decisions) if mine.bpm is not None]
        self.assertGreater(len(weaker), 0.5 * len(pairs))
        # Windows where the two beats drift within the lag of each other look like one heart.
        self.assertGreater(sum(weaker), 0.6 * len(weaker))

    def test_a_moving_sleeper_keeps_its_own_windows_over_the_empty_side(self):
        heart = bcg(SECONDS, 60, jitter_ms=30, seed=9, modulation=0.3)
        movement = np.zeros(int(SECONDS * FS))
        rng = np.random.default_rng(10)
        for onset in (60, 150, 240):
            burst = slice(int(onset * FS), int((onset + 15) * FS))
            movement[burst] = rng.normal(0.0, 4_000_000, burst.stop - burst.start)
        left = heart + movement + breathing(SECONDS, 14) + background(2)
        right = 0.35 * (heart + movement) + background(12)
        pairs, decisions = sides(left, right)
        mine = [keep for (sleeper, _), (keep, _) in zip(pairs, decisions) if sleeper.bpm is not None]
        self.assertGreater(len(mine), 0.5 * len(pairs))
        self.assertTrue(all(mine))
        theirs = [keep for (_, empty), (_, keep) in zip(pairs, decisions) if empty.bpm is not None]
        self.assertLess(sum(theirs), 0.1 * len(pairs))

    def test_windows_without_an_envelope_are_both_kept(self):
        empty = HrWindow(0, None, 0.0, float('nan'), None)
        full = HrWindow(0, 60.0, 0.9, 60.0, np.ones(500))
        self.assertEqual(attribute(empty, full), (True, True))
        self.assertEqual(attribute(full, empty), (True, True))


if __name__ == '__main__':
    unittest.main()
