"""The RAW loader can hand both sides' presence inputs to a collector while it
still drops the other side's data, and loads exactly as before without one."""
import logging
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
sys.path.insert(0, HERE)

import get_logger as _gl

_gl._get_file_handler = lambda data_folder_path, name: logging.NullHandler()
from get_logger import get_logger, LOGGER_NAMES

for _name in LOGGER_NAMES:
    get_logger(_name)

import numpy as np

from load_raw_files import load_raw_files
from presence.cap import CapBaseline
from presence.replay import FrameCollector
import presence_scenarios as scenarios
from presence_scenarios import Night

NIGHT = Night(seconds=900, left=((300, 900),), right=((100, 900),))
BASELINES = {side: CapBaseline(mean=scenarios.BASELINE_MEANS[side], noise=0.05) for side in ('left', 'right')}
START = datetime.fromtimestamp(scenarios.T0, timezone.utc)
END = START + timedelta(seconds=599)


class PresenceCollectorLoadTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        scenarios.write_raw_file(os.path.join(self.folder.name, 'night.RAW'), scenarios.raw_records(NIGHT))

    def _load(self, collector=None):
        return load_raw_files(
            self.folder.name, START, END, 'left', sensor_count=1,
            raw_data_types=['capSense', 'piezo-dual'], presence_collector=collector,
        )

    def test_collector_sees_both_sides_inside_the_window(self):
        collector = FrameCollector(BASELINES)
        self._load(collector)
        frames = list(collector.frames())
        self.assertEqual([frames[0][0], frames[-1][0]], [scenarios.T0, scenarios.T0 + 599])
        t, cap, piezo = frames[400]
        self.assertAlmostEqual(cap['left'], 20.0, places=3)
        self.assertAlmostEqual(cap['right'], 10.0, places=3)
        self.assertEqual(piezo, {'left': 5_000_000.0, 'right': 1_500_000.0})

    def test_loaded_rows_are_the_same_with_or_without_a_collector(self):
        plain = self._load()
        collected = self._load(FrameCollector(BASELINES))
        self.assertEqual(plain.keys(), collected.keys())
        self.assertEqual(plain['cap_senses'], collected['cap_senses'])
        self.assertEqual(len(plain['piezo_dual']), len(collected['piezo_dual']))
        for before, after in zip(plain['piezo_dual'], collected['piezo_dual']):
            self.assertEqual(before.keys(), after.keys())
            self.assertNotIn('right1', after)
            np.testing.assert_array_equal(before['left1'], after['left1'])

    def test_the_collector_keeps_no_raw_samples(self):
        collector = FrameCollector(BASELINES)
        self._load(collector)
        # 600 piezo and 1200 capacitance records at 16 bytes each.
        self.assertEqual(collector.nbytes(), 1800 * 16)

    def test_a_bad_dropped_side_buffer_does_not_cost_the_analyzed_side_its_row(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        records = list(scenarios.raw_records(NIGHT, end=5))
        for record in records:
            if record['type'] == 'piezo-dual':
                record['right1'] = b'abc'
        scenarios.write_raw_file(os.path.join(folder.name, 'night.RAW'), records)
        collector = FrameCollector(BASELINES)
        loaded = load_raw_files(
            folder.name, START, END, 'left', sensor_count=1,
            raw_data_types=['capSense', 'piezo-dual'], presence_collector=collector,
        )
        self.assertEqual(len(loaded['piezo_dual']), 5)
        self.assertEqual(len(list(collector.frames())), 5)


if __name__ == '__main__':
    unittest.main()
