"""Regression: quiet/two-person sessions must not wait for 300 dominant ticks."""
import ast
from collections import deque
from datetime import datetime
from pathlib import Path
import types
import sys
sys.path.insert(0, str(Path(__file__).parents[1]))
import unittest
from vital_quality import has_contiguous_window


class StreamWindowTest(unittest.TestCase):
    def test_established_presence_runs_hrv_even_when_dominance_counter_is_low(self):
        path = Path(__file__).parents[1] / 'stream' / 'stream_processor.py'
        tree = ast.parse(path.read_text())
        cls = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'StreamProcessor')
        scope = {'np': types.SimpleNamespace(ndarray=object), 'PiezoDualData': dict,
                 'datetime': datetime, 'has_contiguous_window': has_contiguous_window}
        exec(compile(ast.Module(body=[cls], type_ignores=[]), str(path), 'exec'), scope)
        processor = scope['StreamProcessor'].__new__(scope['StreamProcessor'])
        processor.iteration_count = 329
        processor.sensor_count = 1
        processor.check_presence = lambda *args: None
        rows = deque([{'ts': n, 'freq': 500, 'left1': [0]*500, 'right1': [0]*500} for n in range(299)], maxlen=300)
        processor.buffer = types.SimpleNamespace(piezo_buffer=rows, append=rows.append,
            get_signal=lambda *args: [], get_heart_rate_signal=lambda *args: [])
        calls = []
        for side in ('left', 'right'):
            child = types.SimpleNamespace(present=True, present_for=8, _presence_session_seconds=329,
                heart_rate_window_seconds=3, breath_rate_window_seconds=30, hrv_window_seconds=300,
                breath_rate_insertion_frequency=10, hrv_insertion_frequency=30,
                calculate_heart_rate=lambda *args: None, calculate_breath_rate=lambda *args: None,
                calculate_hrv=lambda *args, side=side: calls.append(side))
            setattr(processor, side + '_processor', child)
        processor.process_piezo_record({'ts': 299, 'freq': 500, 'left1': [0]*500, 'right1': [0]*500})
        self.assertEqual(calls, ['left', 'right'])
        processor.iteration_count = 359
        processor.left_processor.present = False
        processor.process_piezo_record({'ts': 400, 'freq': 500, 'left1': [0]*500, 'right1': [0]*500})
        self.assertEqual(calls, ['left', 'right'])  # Gap blocks both; absence also blocks left.


if __name__ == '__main__':
    unittest.main()
