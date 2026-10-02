import os
import sys
import time
import tracemalloc
import unittest
from unittest import mock

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.dirname(__file__))

from vitals2 import hr
from vitals2.artifacts import mask_artifacts
from vitals2.hr import HrTracker, estimate_hr
from vitals2_synth import FS, bcg, beat_times, breathing, noise, piezo, pink_noise, varying_beat_times

SEEDS = range(3)


def realistic(seconds, bpm, seed, fs=FS):
    """Beat jitter, breathing modulation of the beats, breathing and 1/f noise."""
    signal = piezo(seconds, bpm=bpm, jitter_ms=40, seed=seed, modulation=0.3, pink_level=25_000).astype(float)
    return signal if fs == FS else signal[::int(FS / fs)]


def stepped(seconds, bpm_at, seed):
    times = varying_beat_times(seconds, bpm_at, jitter_ms=30, seed=seed)
    return (bcg(seconds, times=times, modulation=0.3) + breathing(seconds, 14) + noise(seconds, seed=seed + 1)
            + pink_noise(seconds, 25_000, seed + 2))


def reported(windows):
    return [(window.start, window.bpm) for window in windows if window.bpm is not None]


def machine(seconds, hz=1.4, amplitude=200_000.0, hum=50_000.0):
    """A pump-like periodic vibration below the cardiac band plus a steady in-band hum."""
    t = np.arange(int(seconds * FS)) / FS
    return (sum(amplitude / k * np.sin(2 * np.pi * hz * k * t + k) for k in (1, 2, 3))
            + hum * np.sin(2 * np.pi * 18.0 * t))


def pump_hum(seconds, depth, hz=1.4, carrier=18.0, hum=50_000.0):
    """An in-band hum whose amplitude swings at hz, as a running pump's can."""
    t = np.arange(int(seconds * FS)) / FS
    return hum * (1.0 + depth * np.sin(2 * np.pi * hz * t)) * np.sin(2 * np.pi * carrier * t)


def offline_track(signal, fs):
    """The tracked rate per window from the whole recording at once, smoothed both ways."""
    env, _ = hr.envelope(signal, fs)
    size = int(hr.WINDOW_SECONDS * hr.ENVELOPE_FS)
    starts = np.arange(hr.EDGE_SECONDS, signal.size / fs - hr.WINDOW_SECONDS - hr.EDGE_SECONDS + 1e-9, hr.HOP_SECONDS)
    scores = hr.evidence(np.stack([env[int(s * hr.ENVELOPE_FS):int(s * hr.ENVELOPE_FS) + size] for s in starts]))
    likelihood = np.array([hr.log_likelihood(row, False) for row in scores])
    weights = np.exp(likelihood - likelihood.max(axis=1, keepdims=True))
    count, states = weights.shape
    forward, backward = np.empty((count, states)), np.empty((count, states))
    p = np.full(states, 1.0 / states)
    for t in range(count):
        p = (np.einsum('i,ij->j', p, hr.TRANSITION) if t else p) * weights[t]
        forward[t] = p = p / p.sum()
    q = np.full(states, 1.0 / states)
    for t in range(count - 1, -1, -1):
        backward[t] = q
        q = np.einsum('ij,j->i', hr.TRANSITION, weights[t] * q)
        q /= q.sum()
    posterior = forward * backward
    return {int(s): hr.track_point(row / row.sum())[0] for s, row in zip(starts, posterior)}


class SteadyRateTest(unittest.TestCase):
    def test_recovers_known_rates(self):
        for bpm in (42, 55, 63, 78, 95):
            for seed in SEEDS:
                with self.subTest(bpm=bpm, seed=seed):
                    windows = estimate_hr(realistic(360, bpm, seed), FS)
                    values = np.array([value for _, value in reported(windows)])
                    self.assertGreater(values.size, 0.85 * len(windows))
                    self.assertGreater(np.mean(np.abs(values - bpm) <= 0.05 * bpm), 0.95)
                    self.assertLess(np.max(np.abs(values - bpm)), 0.1 * bpm)
                    self.assertAlmostEqual(float(np.median(values)), bpm, delta=1.0)

    def test_windows_sit_on_the_five_second_grid(self):
        windows = estimate_hr(realistic(300, 60, 0), FS)
        starts = [window.start for window in windows]
        self.assertEqual(starts, list(range(hr.EDGE_SECONDS, starts[-1] + 1, hr.HOP_SECONDS)))
        self.assertTrue(all(window.envelope.size == hr.WINDOW_SECONDS * hr.ENVELOPE_FS for window in windows))

    def test_lower_sample_rate(self):
        values = [value for _, value in reported(estimate_hr(realistic(300, 70, 1, fs=250.0), 250.0))]
        self.assertGreater(len(values), 45)
        self.assertAlmostEqual(float(np.median(values)), 70, delta=1.0)

    def test_second_hump_is_not_counted_as_a_beat(self):
        for seed in SEEDS:
            with self.subTest(seed=seed):
                onsets = beat_times(360, 55, 30, seed)
                signal = (bcg(360, times=onsets, modulation=0.3) + 0.6 * bcg(360, times=onsets + 0.42, modulation=0.3)
                          + breathing(360, 15) + noise(360, seed=seed + 1) + pink_noise(360, 25_000, seed + 2))
                values = np.array([value for _, value in reported(estimate_hr(signal, FS))])
                self.assertGreater(values.size, 60)
                self.assertEqual(int(np.sum(values > 80)), 0)
                self.assertAlmostEqual(float(np.median(values)), 55, delta=1.0)

    def test_a_hump_at_half_the_period_is_refused_rather_than_doubled(self):
        # A copy of every beat half a period later looks like a train at twice the rate.
        for seed in SEEDS:
            with self.subTest(seed=seed):
                signal = (bcg(360, 55, jitter_ms=30, second_hump=0.6, seed=seed, modulation=0.3)
                          + breathing(360, 15) + noise(360, seed=seed + 1) + pink_noise(360, 25_000, seed + 2))
                self.assertFalse([value for _, value in reported(estimate_hr(signal, FS)) if value > 80])

    def test_strong_breathing_does_not_leak_into_the_rate(self):
        signal = (bcg(300, 66, jitter_ms=30, modulation=0.5) + breathing(300, 16, amplitude=3_000_000)
                  + noise(300) + pink_noise(300, 25_000))
        values = [value for _, value in reported(estimate_hr(signal, FS))]
        self.assertTrue(values)
        self.assertTrue(all(abs(value - 66) < 3.3 for value in values))

    def test_a_fast_rate_is_never_halved(self):
        for bpm in (110, 120):
            with self.subTest(bpm=bpm):
                values = [value for _, value in reported(estimate_hr(realistic(300, bpm, 0), FS))]
                self.assertTrue(all(abs(value - bpm) < 0.05 * bpm for value in values))

    def test_amplitude_does_not_matter(self):
        signal = realistic(300, 66, 2)
        first = reported(estimate_hr(signal, FS))
        second = reported(estimate_hr(signal * 1000.0, FS))
        self.assertEqual([start for start, _ in first], [start for start, _ in second])
        np.testing.assert_allclose([value for _, value in first], [value for _, value in second], atol=1e-6)


class ChangingRateTest(unittest.TestCase):
    def test_tracks_a_slow_ramp(self):
        signal = stepped(600, lambda t: 55.0 + 20.0 * t / 600.0, 3)
        rows = reported(estimate_hr(signal, FS))
        truth = np.array([55.0 + 20.0 * (start + 5) / 600.0 for start, _ in rows])
        self.assertGreater(len(rows), 90)
        self.assertGreater(np.mean(np.abs(np.array([value for _, value in rows]) - truth) <= 3), 0.9)

    def test_a_step_is_followed_within_fifteen_seconds(self):
        step = 300
        for seed in range(5):
            with self.subTest(seed=seed):
                rows = reported(estimate_hr(stepped(600, lambda t: 60.0 if t < step else 90.0, seed), FS))
                for start, value in rows:
                    if start + hr.WINDOW_SECONDS <= step:
                        self.assertLess(abs(value - 60), 3.0)
                    elif start >= step + 15:
                        self.assertLess(abs(value - 90), 4.5)
                    else:
                        self.assertLess(min(abs(value - 60), abs(value - 90)), 4.5)
                self.assertTrue(any(step <= start <= step + 15 and abs(value - 90) < 4.5 for start, value in rows))

    def test_minute_batches_match_the_whole_recording_smoothed_both_ways(self):
        for seed in range(2):
            with self.subTest(seed=seed):
                signal = stepped(900, lambda t: 52 + 0.03 * t if t < 600 else 70 - 0.02 * (t - 600), seed)
                offline = offline_track(signal, FS)
                windows = estimate_hr(signal, FS)
                rows = reported(windows)
                self.assertGreater(len(rows), 0.9 * len(windows))
                errors = np.array([abs(np.log(value / offline[start])) for start, value in rows])
                self.assertGreater(np.mean(errors <= 0.02), 0.95)


class RefusalTest(unittest.TestCase):
    def test_noise_and_breathing_alone_report_almost_nothing(self):
        signal = noise(600, level=1.0, seed=4) + breathing(600, 15, amplitude=3.0)
        windows = estimate_hr(signal, FS)
        self.assertLess(len(reported(windows)), 0.05 * len(windows))

    def test_empty_bed_with_machine_vibration_reports_almost_nothing(self):
        windows = []
        for seed in range(5):
            signal = machine(600) + noise(600, seed=seed) + pink_noise(600, 25_000, seed + 1) + 400_000
            windows += estimate_hr(signal, FS)
        self.assertLessEqual(len(reported(windows)), 0.02 * len(windows))

    def test_flat_input_reports_nothing(self):
        self.assertEqual(reported(estimate_hr(np.zeros(int(300 * FS)), FS)), [])
        self.assertEqual(estimate_hr(np.zeros(100), FS), [])

    def test_non_finite_batches_are_skipped(self):
        signal = realistic(120, 60, 0)
        signal[1000] = np.nan
        self.assertEqual(HrTracker().step(signal, FS, 120.0), [])

    def test_a_movement_burst_is_not_reported(self):
        signal = realistic(600, 60, 6)
        burst = slice(int(300 * FS), int(330 * FS))
        signal[burst] += np.random.default_rng(7).normal(0.0, 8_000_000, burst.stop - burst.start)
        rows = reported(estimate_hr(signal, FS))
        self.assertFalse([start for start, _ in rows if 300 - hr.WINDOW_SECONDS + 2 < start < 330 - 2])
        self.assertAlmostEqual(float(np.median([value for _, value in rows])), 60, delta=1.0)

    def test_each_window_carries_its_share_of_moving_seconds(self):
        signal = realistic(600, 60, 6)
        burst = slice(int(300 * FS), int(330 * FS))
        signal[burst] += np.random.default_rng(7).normal(0.0, 8_000_000, burst.stop - burst.start)
        cleaned, bad = mask_artifacts(signal)
        motion = {window.start: window.motion for window in estimate_hr(cleaned, FS, bad=bad)}
        self.assertEqual(motion[310], 1.0)
        self.assertEqual(motion[200], 0.0)
        self.assertTrue(0.4 <= motion[295] <= 0.7, motion[295])

    def test_clipped_seconds_are_not_reported(self):
        raw = piezo(600, bpm=60, jitter_ms=40, seed=8, modulation=0.3, pink_level=25_000).astype(np.int64)
        raw[int(200 * FS):int(225 * FS):50] = 8_388_607
        cleaned, bad = mask_artifacts(raw)
        rows = reported(estimate_hr(cleaned, FS, bad=bad))
        self.assertFalse([start for start, _ in rows if 192 < start < 223])
        self.assertGreater(len(rows), 90)

    def test_long_dropouts_are_not_reported(self):
        raw = piezo(600, bpm=60, jitter_ms=40, seed=9, modulation=0.3, pink_level=25_000).astype(np.int64)
        for second in range(7, 600, 7):
            raw[int(second * FS):int(second * FS) + 5] = 2147483647
        for second in (200, 400):
            raw[int(second * FS):int((second + 3) * FS)] = 2147483647
        cleaned, bad = mask_artifacts(raw)
        rows = reported(estimate_hr(cleaned, FS, bad=bad))
        self.assertFalse([start for start, _ in rows if 193 <= start <= 200 or 393 <= start <= 400])
        self.assertGreater(len(rows), 90)
        self.assertAlmostEqual(float(np.median([value for _, value in rows])), 60, delta=1.0)

    def test_a_mask_of_the_wrong_length_is_refused(self):
        signal = realistic(120, 60, 0)
        with self.assertRaises(ValueError):
            HrTracker().step(signal, FS, 120.0, bad=np.zeros(signal.size - 1, dtype=bool))


class KnownLimitTest(unittest.TestCase):
    def test_a_pump_hum_swinging_at_a_heart_like_rate_reads_as_that_rate(self):
        """Known limit: an empty bed with an 18 Hz hum swinging at 1.4 Hz reports about 84 bpm.

        One side's signal cannot tell this from a heartbeat, so the estimator
        is not the fail-safe for it: the stream reports heart rate only while
        the side is present and not while the pump runs hard. This pins what
        the estimator does today, so a change that fixes or worsens it fails
        here and the numbers get revisited.
        """
        windows = []
        for depth in (0.3, 0.6):
            for seed in SEEDS:
                signal = pump_hum(600, depth) + noise(600, seed=seed) + pink_noise(600, 25_000, seed + 1) + 400_000
                windows += estimate_hr(signal, FS)
        values = np.array([value for _, value in reported(windows)])
        self.assertTrue(0.6 < values.size / len(windows) < 0.9)
        self.assertAlmostEqual(float(np.median(values)), 84.0, delta=1.0)


class CrosstalkTest(unittest.TestCase):
    def test_a_side_hearing_only_the_partner_reads_the_partner_weaker(self):
        # A single side cannot tell whose heart it hears; attribution needs the
        # rate and the envelope, and the partner's envelope is the stronger one.
        heart = bcg(600, 64, jitter_ms=30, seed=1, modulation=0.3)
        partner = estimate_hr(heart + breathing(600, 14) + noise(600, seed=2) + pink_noise(600, 25_000, 3), FS)
        empty = estimate_hr(0.35 * heart + noise(600, seed=12) + pink_noise(600, 25_000, 13), FS)
        values = [value for _, value in reported(empty)]
        self.assertGreater(len(values), 0.5 * len(empty))
        self.assertAlmostEqual(float(np.median(values)), 64, delta=1.0)
        ratios = [np.std(mine.envelope) / np.std(theirs.envelope) for mine, theirs in zip(empty, partner)]
        self.assertLess(max(ratios), 0.6)


class TrackerStateTest(unittest.TestCase):
    def feed(self, tracker, signal, ends, origin=1_790_600_400):
        out = []
        for end in ends:
            b = int(end * FS)
            a = max(0, b - int(hr.BUFFER_SECONDS * FS))
            out.append(tracker.step(signal[a:b], FS, origin + end))
        return out

    def test_windows_are_returned_after_the_report_delay(self):
        signal = realistic(400, 60, 0)
        ends = list(range(106, 400, 60))
        tracker = HrTracker()
        for end, windows in zip(ends, self.feed(tracker, signal, ends)):
            self.assertTrue(windows)
            last = windows[-1].start - 1_790_600_400
            self.assertEqual(last, (end - hr.EDGE_SECONDS - hr.WINDOW_SECONDS) // 5 * 5 - hr.OCTAVE_HOPS * 5)
            self.assertLessEqual(last, end - hr.REPORT_DELAY_SECONDS)

    def test_a_missed_minute_is_filled_and_a_long_gap_starts_over(self):
        signal = realistic(1500, 60, 1)
        tracker = HrTracker()
        before, after_short = self.feed(tracker, signal, [200, 320])
        starts = [window.start for window in before + after_short]
        self.assertEqual(starts, list(range(starts[0], starts[-1] + 1, 5)))
        self.assertTrue(any(window.bpm is None and window.envelope is None for window in after_short))
        tracker.flush()
        [after_long] = self.feed(tracker, signal, [1100])
        self.assertTrue(after_long)
        self.assertGreater(after_long[0].start - starts[-1], hr.RESET_GAP_SECONDS)

    def test_a_long_gap_returns_the_waiting_windows_before_starting_over(self):
        signal = realistic(1500, 60, 1)
        tracker = HrTracker()
        before = [window for batch in self.feed(tracker, signal, [200, 260]) for window in batch]
        [after_gap] = self.feed(tracker, signal, [1100])
        waiting = [window for window in after_gap if window.start < 1_790_600_400 + 260]
        starts = [window.start for window in before + waiting]
        # Every window up to the gap comes back once, in order, on the old grid.
        self.assertEqual(starts, list(range(starts[0], starts[-1] + 1, 5)))
        self.assertEqual(len(waiting), hr.OCTAVE_HOPS)
        self.assertTrue(all(window.bpm is not None for window in waiting))
        fresh = after_gap[len(waiting):]
        self.assertTrue(fresh)
        self.assertEqual(tracker.pending_from(), fresh[-1].start + hr.HOP_SECONDS)
        self.assertGreater(fresh[0].start - starts[-1], hr.RESET_GAP_SECONDS)

    def test_reset_forgets_the_track(self):
        tracker = HrTracker()
        self.feed(tracker, realistic(400, 60, 2), [200, 260, 320])
        tracker.reset()
        [windows] = self.feed(tracker, realistic(400, 60, 2), [380])
        # Nothing is filled back to the old track: the first window is the batch's first.
        self.assertEqual(windows[0].start, 1_790_600_400 + 380 - hr.BUFFER_SECONDS + hr.EDGE_SECONDS)
        self.assertEqual(len(windows) + len(tracker.flush()), 13)

    def test_a_minute_batch_fits_its_budget(self):
        # Timing alone is too noisy on a loaded runner to catch a few times
        # the work, so the work is counted too: one resample and one envelope
        # over the whole batch, with no filter designed per batch.
        signal = realistic(660, 60, 3)
        ends = range(166, 660, 60)
        tracker = HrTracker()
        self.feed(tracker, signal, [106])
        designed = hr._polyphase.cache_info()
        with mock.patch.object(hr.signal, 'sosfiltfilt', wraps=hr.signal.sosfiltfilt) as filtered, \
                mock.patch.object(hr.signal, 'resample_poly', wraps=hr.signal.resample_poly) as resampled, \
                mock.patch.object(hr.signal, 'butter', wraps=hr.signal.butter) as butter, \
                mock.patch.object(hr.signal, 'firwin', wraps=hr.signal.firwin) as firwin:
            started = time.process_time()
            self.feed(tracker, signal, ends)
            per_batch = (time.process_time() - started) / len(ends)
        reused = hr._polyphase.cache_info()
        tracker = HrTracker()
        self.feed(tracker, signal, [106])
        tracemalloc.start()
        self.feed(tracker, signal, ends)
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        self.assertEqual(resampled.call_count, len(ends))
        self.assertEqual(filtered.call_count, 3 * len(ends))
        self.assertTrue(all(call.args[1].size == hr.BUFFER_SECONDS * hr.WORK_FS for call in filtered.call_args_list))
        self.assertEqual((butter.call_count, firwin.call_count), (0, 0))
        self.assertEqual(reused.misses, designed.misses)
        self.assertEqual(reused.hits - designed.hits, len(ends))
        self.assertLess(per_batch, 0.05)
        self.assertLess(peak / 2 ** 20, 8.0)


if __name__ == '__main__':
    unittest.main()
