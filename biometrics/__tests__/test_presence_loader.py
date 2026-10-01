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

from load_raw_files import _capture_presence, load_raw_files
from presence.cap import CapBaseline
from presence.replay import FrameCollector
from presence.sensors import CAPSENSE, CAPSENSE2
import presence_scenarios as scenarios
from presence_scenarios import Night

NIGHT = Night(seconds=900, left=((300, 900),), right=((100, 900),))
BASELINES = {side: CapBaseline(mean=scenarios.BASELINE_MEANS[side], noise=0.05) for side in ('left', 'right')}
START = datetime.fromtimestamp(scenarios.T0, timezone.utc)
END = START + timedelta(seconds=599)


class CapturePresenceTest(unittest.TestCase):
    def _record(self, left, right):
        return {'type': 'capSense2', 'ts': scenarios.T0, 'left': left, 'right': right}

    def test_both_sides_are_captured_as_channels(self):
        side = {'values': [12.0] * 8}
        self.assertEqual(_capture_presence(self._record(side, side)),
                         ('cap', (12.0, 12.0, 12.0), (12.0, 12.0, 12.0), 'capSense2'))

    def test_a_record_with_an_unreadable_side_is_not_captured(self):
        side = {'values': [12.0] * 8}
        for bad in (None, {}, {'values': [10 ** 400] * 8}, {'values': ['12'] * 8}):
            with self.subTest(bad=bad):
                self.assertIsNone(_capture_presence(self._record(bad, side)))
                self.assertIsNone(_capture_presence(self._record(side, bad)))
        self.assertIsNone(_capture_presence(self._record(None, None)))

    def test_a_timestamp_that_is_not_a_number_does_not_matter_here(self):
        side = {'values': [12.0] * 8}
        record = self._record(side, side)
        record['ts'] = 'soon'
        self.assertIsNotNone(_capture_presence(record))

    def test_a_legacy_record_is_captured_with_its_format(self):
        side = {'out': 387, 'cen': 381, 'in': 505, 'status': 'good'}
        record = {'type': 'capSense', 'ts': scenarios.T0, 'seq': 1, 'left': side, 'right': side}
        self.assertEqual(_capture_presence(record), ('cap', (387.0, 381.0, 505.0), (387.0, 381.0, 505.0), 'capSense'))

    def test_an_unknown_capacitance_type_is_captured_by_name(self):
        self.assertEqual(_capture_presence({'type': 'capSense3', 'ts': scenarios.T0}), ('unknown', 'capSense3'))
        self.assertIsNone(_capture_presence({'type': 'bedTemp', 'ts': scenarios.T0}))


def legacy(records):
    """The same night in the capSense shape: integer counts, one channel per pair."""
    out = []
    for record in records:
        if record['type'] != 'capSense2':
            out.append(record)
            continue
        converted = {'type': 'capSense', 'ts': record['ts'], 'seq': 1}
        for side in ('left', 'right'):
            values = record[side]['values']
            converted[side] = {'out': int(round(values[0] * 30)), 'cen': int(round(values[2] * 30)),
                               'in': int(round(values[4] * 30)), 'status': 'good'}
        out.append(converted)
    return out


class FormatTest(unittest.TestCase):
    def _collect(self, records):
        with tempfile.TemporaryDirectory() as folder:
            scenarios.write_raw_file(os.path.join(folder, 'night.RAW'), records)
            collector = FrameCollector(BASELINES)
            loaded = load_raw_files(folder, START, END, 'left', sensor_count=1,
                                    raw_data_types=['capSense', 'piezo-dual'], presence_collector=collector)
        return collector, loaded

    def test_capsense2_is_counted(self):
        collector, _ = self._collect(scenarios.raw_records(NIGHT))
        self.assertIs(collector.cap_format(), CAPSENSE2)
        self.assertEqual(collector.cap_formats['capSense2'], 1200)

    def test_legacy_capsense_reaches_the_collector(self):
        collector, loaded = self._collect(legacy(scenarios.raw_records(NIGHT)))
        self.assertIs(collector.cap_format(), CAPSENSE)
        self.assertGreater(collector.cap_coverage(), 0.99)
        self.assertEqual(len(loaded['cap_senses']), 1200)

    def test_the_piezo_layout_and_cadence_are_kept(self):
        collector, _ = self._collect(scenarios.raw_records(NIGHT))
        self.assertEqual(collector.piezo_layout.freq, 500)
        self.assertEqual(collector.piezo_layout.sensors_per_side, 2)
        self.assertEqual(collector.one_per_second_share(), 1.0)

    def test_an_unknown_capacitance_type_is_named_and_not_read(self):
        records = [dict(record, type='capSense3') if record['type'] == 'capSense2' else record
                   for record in scenarios.raw_records(NIGHT)]
        collector, _ = self._collect(records)
        self.assertIsNone(collector.cap_format())
        # Only records inside the window, as calibration counts them.
        self.assertEqual(collector.unknown_cap['capSense3'], 1200)
        self.assertEqual(collector.cap_coverage(), 0.0)

    def test_the_common_format_wins_and_a_tie_goes_to_the_one_listed_first(self):
        collector = FrameCollector(BASELINES)
        collector.note_cap_format('capSense')
        self.assertIs(collector.cap_format(), CAPSENSE)
        collector.note_cap_format('capSense2')
        self.assertIs(collector.cap_format(), CAPSENSE2)
        collector.note_cap_format('capSense')
        self.assertIs(collector.cap_format(), CAPSENSE)


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

    def test_a_collector_that_raises_costs_no_row(self):
        class Raising:
            def add_cap(self, *args):
                raise ValueError('bad reading')

            def add_piezo(self, *args):
                raise ValueError('bad reading')

        plain = self._load()
        collected = self._load(Raising())
        self.assertEqual(plain['cap_senses'], collected['cap_senses'])
        self.assertEqual(len(plain['piezo_dual']), len(collected['piezo_dual']))

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
