import os
import sys
import unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from sensor_telemetry import normalize


class SensorTelemetryTest(unittest.TestCase):
    def test_temperature_units_sentinels_and_missing_channels(self):
        row = {'type': 'bedTemp', 'ts': 100, 'amb': 2200, 'left': {'side': -32768, 'in': 2345}}
        sample = normalize(row, 105)
        self.assertEqual(sample['fields']['ambC'], 22)
        self.assertEqual(sample['fields']['left.inC'], 23.45)
        # Invalid negative extreme and absent channels stay unknown.
        self.assertIsNone(sample['fields']['left.sideC'])
        self.assertIsNone(sample['fields']['right.inC'])

    def test_freshness_and_water_are_explicit(self):
        for stamp in (None, True, float('nan'), 101, 0):
            self.assertIsNone(normalize({'type': 'frzHealth', 'ts': stamp}, 100))
        sample = normalize({'type': 'frzHealth', 'ts': 100, 'left': {'tec': {'current': -1}, 'pump': {'rpm': 1900}}}, 100)
        self.assertIsNone(sample['fields']['left.waterDetected'])
        self.assertIsNone(sample['fields']['left.reportedTecCurrent'])
        self.assertEqual(sample['fields']['left.pumpRpm'], 1900)

    def test_malformed_nested_channels_remain_unknown(self):
        sample = normalize({'type': 'frzHealth', 'ts': 100, 'fan': ['bad'],
                            'left': {'pump': 4, 'tec': 'bad', 'temps': True}}, 100)
        self.assertIsNone(sample['fields']['left.pumpRpm'])
        self.assertIsNone(sample['fields']['top.fanRpm'])

    def test_never_forwards_waveforms_or_logs(self):
        self.assertIsNone(normalize(None, 100))
        self.assertIsNone(normalize([], 100))
        self.assertIsNone(normalize({'type': 'piezo-dual', 'ts': 100, 'left1': b'private'}, 100))
        self.assertIsNone(normalize({'type': 'log', 'ts': 100, 'msg': 'private'}, 100))


if __name__ == '__main__':
    unittest.main()
