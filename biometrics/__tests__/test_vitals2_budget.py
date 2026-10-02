"""The v2 stream stays within its CPU and memory budget with both sides occupied."""
import os
import sys
import time
import tracemalloc
import unittest

sys.path.insert(0, os.path.dirname(__file__))

import stream_fixture
from buffer import Buffer
from presence.piezo import PiezoLayout
from vitals2_stream import Vitals2Stream
from vitals2_synth import piezo

SECONDS = 600
WARM_SECONDS = 300
LAYOUT = PiezoLayout(freq=500, samples=500, sensors_per_side=1)
# Generous ceilings for a CI runner; the Pod's own figures are measured on the Pod.
MAX_MS_PER_RECORD = 25.0
MAX_PEAK_MB = 24.0


class Vitals2BudgetTest(unittest.TestCase):
    def test_ten_minutes_of_two_occupied_sides(self):
        left = piezo(SECONDS, bpm=57, per_minute=13, jitter_ms=25, seed=1)
        right = piezo(SECONDS, bpm=71, per_minute=17, jitter_ms=35, seed=2)
        buffer = Buffer(3, 30, 300)
        stream = Vitals2Stream()
        present = {'left': True, 'right': True}
        rows = []
        tracemalloc.start()
        started = time.process_time()
        warm = None
        for second in range(SECONDS):
            if second == WARM_SECONDS:
                warm = time.process_time()
            window = slice(second * 500, (second + 1) * 500)
            buffer.append({'ts': stream_fixture.START + second, 'left1': left[window], 'right1': right[window]})
            rows += stream.step(stream_fixture.START + second, LAYOUT, buffer, present, cap_age=1)
        ended = time.process_time()
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        per_record_ms = (ended - started) / SECONDS * 1000
        # Once five minutes of buffer exist, HRV runs every minute too.
        steady_ms = (ended - warm) / (SECONDS - WARM_SECONDS) * 1000
        peak_mb = peak / 2 ** 20
        print(f'v2 stream: {per_record_ms:.2f} ms per record overall, {steady_ms:.2f} in steady state '
              f'({steady_ms * 3.6:.1f} s CPU per hour), traced peak {peak_mb:.1f} MB, {len(rows)} rows')
        self.assertLess(steady_ms, MAX_MS_PER_RECORD)
        self.assertLess(peak_mb, MAX_PEAK_MB)
        self.assertEqual({row['side'] for row in rows}, {'left', 'right'})
        self.assertEqual({row['heart_rate'] for row in rows if row['side'] == 'left'}, {57})


if __name__ == '__main__':
    unittest.main()
