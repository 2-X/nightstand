import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from firmware_telemetry import normalize_record


class TapDiagnosticsTest(unittest.TestCase):
    def test_button_records_stay_separate_from_gestures(self):
        row = {'type': 'buttonEvent', 'ts': 100, 'right': {'top': 1, 'bottom': 2}}
        events = normalize_record(row, 'RAW', 100)
        self.assertEqual([(e['side'], e['control'], e['count']) for e in events],
                         [('right', 'top', 1), ('right', 'bottom', 2)])
        self.assertTrue(all(e['origin'] == 'buttonEvent' for e in events))

    def test_documented_gesture_shape_and_dismissal_are_diagnostic_only(self):
        # No tap-gesture or dismissal-log examples exist in the local captures.
        for kind, row in [('tap-gesture', {'type': 'tap-gesture', 'side': 'left', 'taps': 3}),
                          ('alarm-dismiss-log', {'type': 'log', 'msg': '[lisR] dismissing alarm (2 taps)'})]:
            event = normalize_record({**row, 'ts': 100}, 'NATS', 100)[0]
            self.assertEqual(event['origin'], kind)
            self.assertEqual(event['source'], 'NATS')
        for count in (True, 0, 17, float('nan')):
            self.assertEqual(normalize_record({'type': 'tap-gesture', 'ts': 100, 'side': 'left', 'taps': count}, 'RAW', 100), [])
        self.assertEqual(normalize_record({'type': 'log', 'ts': 100, 'msg': '[lisX] dismissing alarm (2 taps)'}, 'RAW', 100), [])


if __name__ == '__main__':
    unittest.main()
