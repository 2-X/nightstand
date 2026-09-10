import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from adaptive_circulation import circulation_sample


class CirculationTests(unittest.TestCase):
    def test_requires_fresh_source_time_and_explicit_flow(self):
        frame = {'ts': 100, 'left': {'pump': {'rpm': 1950, 'water': True}}, 'right': {}}
        self.assertEqual(circulation_sample(frame, 101), {'at': 100000, 'left': True, 'right': False,
            'readings': {'left': {'rpm': 1950, 'water': True}, 'right': {'rpm': None, 'water': None}}})
        for timestamp in [None, True, float('nan'), float('inf'), 60, 102]:
            self.assertIsNone(circulation_sample(dict(frame, ts=timestamp), 101))
        for pump in [{}, {'rpm': 0, 'water': True}, {'rpm': 1950}, {'rpm': 1950, 'water': False},
                     {'rpm': float('nan'), 'water': True}]:
            result = circulation_sample(dict(frame, left={'pump': pump}), 101)
            self.assertFalse(result['left'])


if __name__ == '__main__':
    unittest.main()
