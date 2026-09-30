"""analyze_sleep.py reads RAW over the widened window and writes with it."""
import logging
import os
import runpy
import sqlite3
import sys
import types
import unittest
import unittest.mock
from datetime import datetime, timezone

import pandas as pd

BIOMETRICS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
sys.path.insert(0, BIOMETRICS)
import get_logger as gl

gl._get_file_handler = lambda *args: logging.NullHandler()
for name in gl.LOGGER_NAMES:
    gl.get_logger(name)

SCRIPT = os.path.join(BIOMETRICS, 'sleep_detection', 'analyze_sleep.py')
START, END = 1790668000, 1790690000
WIDE_START, WIDE_END = 1790650000, 1790695000


class WidenedWindowWiringTest(unittest.TestCase):
    def _run(self):
        calls = {}
        frame = pd.DataFrame({'left_out': [1.0]})
        db = types.ModuleType('db')
        db.conn = sqlite3.connect(':memory:')
        db.widen_window = lambda side, start, end: calls.setdefault('widen', (side, start, end)) and (WIDE_START, WIDE_END)
        db.replace_analysis_results = lambda *args: calls.setdefault('write', args) and (0, 0)
        detector = types.ModuleType('sleep_detector')
        detector.detect_sleep = lambda side, start, end, folder: calls.setdefault('read', (start, end)) and (frame, [], frame)
        detector.detect_movement = lambda side, cap_df: []
        health = types.ModuleType('service_health')
        health.update_health = lambda key, status, message: calls.setdefault('health', []).append(status)
        health.is_biometrics_enabled = lambda: True
        usage = types.ModuleType('resource_usage')
        usage.get_memory_usage_unix = lambda: 0.0
        usage.get_available_memory_mb = lambda: 2000
        usage.get_peak_rss_mb = lambda: 1.0
        argv = ['analyze_sleep.py', '--side=left',
                f'--start_time={datetime.fromtimestamp(START, timezone.utc):%Y-%m-%dT%H:%M:%SZ}',
                f'--end_time={datetime.fromtimestamp(END, timezone.utc):%Y-%m-%dT%H:%M:%SZ}']
        with unittest.mock.patch.dict(sys.modules, {'db': db, 'sleep_detector': detector,
                                                    'service_health': health, 'resource_usage': usage}), \
                unittest.mock.patch.object(sys, 'argv', argv), \
                unittest.mock.patch.object(sys, 'path', list(sys.path)):
            runpy.run_path(SCRIPT, run_name='__main__')
        return calls

    def test_the_widened_window_reaches_the_raw_read_and_the_writer(self):
        calls = self._run()
        self.assertEqual(calls['widen'], ('left', START, END))
        self.assertEqual(calls['read'], (datetime.fromtimestamp(WIDE_START, timezone.utc),
                                         datetime.fromtimestamp(WIDE_END, timezone.utc)))
        self.assertEqual(calls['write'], ('left', [], [], WIDE_START, WIDE_END))
        self.assertEqual(calls['health'], ['started', 'healthy'])


if __name__ == '__main__':
    unittest.main()
