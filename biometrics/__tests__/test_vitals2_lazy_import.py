"""With the switch off the stream never loads the newer vitals estimators; the first switch-on loads them."""
import json
import os
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))

PROBE = r'''
import json, logging, os, sys, tempfile, types
here = sys.argv[1]
sys.path[:0] = [os.path.join(here, '..'), os.path.join(here, '..', 'stream'), here]
import get_logger as gl
gl._get_file_handler = lambda *args: logging.NullHandler()
folder = tempfile.mkdtemp() + '/'
for name in gl.LOGGER_NAMES:
    gl.get_logger(name).folder_path = folder
sys.modules['db'] = types.SimpleNamespace(insert_vitals=lambda *a, **k: None)
import stream
import stream_fixture

def loaded():
    return sorted(m for m in sys.modules if m == 'vitals2_stream' or m == 'vitals2' or m.startswith('vitals2.'))

out = {'after_import': loaded()}
processor = None
for record in stream_fixture.records(90):
    if processor is None:
        processor = stream.StreamProcessor(record, debug=False, pump=stream.pump_speed)
    processor.use_vitals_v2(False)
    processor.process_piezo_record(record)
out['switch_off'] = loaded()
out['estimators_built'] = processor.vitals2 is not None
processor.use_vitals_v2(True)
out['switch_on'] = loaded()
print(json.dumps(out))
'''


class LazyImportTest(unittest.TestCase):
    def test_the_newer_vitals_load_only_when_switched_on(self):
        done = subprocess.run([sys.executable, '-c', PROBE, HERE], capture_output=True, text=True, timeout=120)
        self.assertEqual(done.returncode, 0, done.stderr[-2000:])
        out = json.loads(done.stdout.strip().splitlines()[-1])
        self.assertEqual(out['after_import'], [])
        self.assertEqual(out['switch_off'], [])
        self.assertFalse(out['estimators_built'])
        self.assertIn('vitals2_stream', out['switch_on'])
        self.assertIn('vitals2.hr', out['switch_on'])


if __name__ == '__main__':
    unittest.main()
