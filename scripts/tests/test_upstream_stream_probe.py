"""The launch probe counts processor returns, not incoming records."""
import importlib.util
import json
import logging
import traceback
from types import SimpleNamespace
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))


class UpstreamStreamProbeTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('upstream_stream_probe', SCRIPTS / 'upstream_stream_probe.py')
        self.assertTrue(Path(spec.origin).exists(), 'Stream probe is missing')
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.output = self.root / 'probe.json'

    def test_successful_returns_advance_and_exceptions_never_count_as_success(self):
        clock = [40]
        probe = self.module.Probe(self.output, 'launch-token', clock=lambda: clock[0])
        class Processor:
            def process_piezo_record(self, value):
                if value == 'bad':
                    raise RuntimeError('processing failed')
                return value
        probe.instrument(Processor)
        processor = Processor()
        self.assertEqual(processor.process_piezo_record('good'), 'good')
        self.assertIsNone(processor.process_piezo_record(None))
        with self.assertRaisesRegex(RuntimeError, 'processing failed'):
            processor.process_piezo_record('bad')
        probe.publish()
        status = json.loads(self.output.read_text())
        self.assertEqual(status['successes'], 2)
        self.assertEqual(status['errors'], 1)
        self.assertEqual(status['token'], 'launch-token')
        self.assertEqual(status['pid'], os.getpid())

    def test_upstream_caught_calculation_errors_never_pass_readiness(self):
        import upstream_readiness
        clock = [0]
        probe = self.module.Probe(self.output, 'launch-token', clock=lambda: clock[0])
        probe.state['procStartTicks'] = 100  # Synthetic Linux launch identity.
        logger = logging.getLogger('upstream-calculation-fixture')
        logger.addHandler(logging.NullHandler())
        self.addCleanup(logger.handlers.clear)
        class BadSignalWarning(Exception):
            pass
        def clean(signal, **kwargs):
            if signal == 'unexpected':
                raise RuntimeError('injected calculation failure')
            raise BadSignalWarning('expected bad signal')
        namespace = dict(logger=logger, traceback=traceback, BadSignalWarning=BadSignalWarning,
                         interpolate_outliers_in_wave=clean)
        source = (SCRIPTS / 'tests/fixtures/upstream_calculate_vitals.py').read_text()
        exec(compile(source, 'upstream_calculate_vitals.py', 'exec'), namespace)
        calculate = namespace['_calculate_vitals']
        class Processor:
            def process_piezo_record(self, signal):
                if signal == 'empty':
                    return None
                return calculate(SimpleNamespace(signal_percentile=(1, 99)), signal, clock[0])
        probe.instrument(Processor)
        processor = Processor()
        self.assertIsNone(processor.process_piezo_record('empty'))
        self.assertIsNone(processor.process_piezo_record('bad-signal'))
        self.assertEqual(probe.state['errors'], 0)
        self.assertEqual(probe.state['successes'], 2)
        check = upstream_readiness.Readiness('3.0.3', True, 'launch-token')
        accepted = []
        for now in range(0, 91, 5):
            clock[0] = now
            self.assertIsNone(processor.process_piezo_record('unexpected'))
            probe.publish()
            status = json.loads(self.output.read_text())
            def service(pid):
                return dict(active=True, pid=pid, invocation='a' * 32, start=1,
                            restarts=0, procStartTicks=status['procStartTicks'])
            sample = dict(version='3.0.3', enabled=True, server=service(10), stream=service(status['pid']),
                          health=dict(status='healthy', age=0, postLaunch=True), probe=status)
            accepted.append(check.observe(sample, now))
        self.assertEqual(probe.state['successes'], 2)
        self.assertEqual(probe.state['errors'], 19)
        self.assertFalse(any(accepted))

    def test_dead_processing_worker_is_reported(self):
        probe = self.module.Probe(self.output, 'launch-token')
        class Processor:
            def process_piezo_record(self, value):
                return value
        probe.instrument(Processor)
        worker = threading.Thread(target=lambda: Processor().process_piezo_record('good'))
        worker.start()
        worker.join()
        probe.publish()
        self.assertFalse(json.loads(self.output.read_text())['workerAlive'])

    def run_stream(self, source, processor_source=None):
        stream = self.root / 'tree/biometrics/stream'
        stream.mkdir(parents=True, exist_ok=True)
        (stream / 'stream_processor.py').write_text(processor_source or
            'class StreamProcessor:\n'
            '    def process_piezo_record(self, record):\n'
            '        if record == "bad": raise ValueError("bad record")\n'
            '        return record\n')
        (stream / 'stream.py').write_text(source)
        return subprocess.run([sys.executable, '-B', str(SCRIPTS / 'upstream_stream_probe.py'),
                               '--tree', str(self.root / 'tree'), '--output', str(self.output),
                               '--launch-token', 'launch-token'], capture_output=True, text=True, timeout=5)

    def test_wrapper_runs_unmodified_stream_and_captures_caught_processing_error(self):
        result = self.run_stream(
            'import time\ntime.sleep(0.01)\n'
            'from stream_processor import StreamProcessor\n'
            'processor = StreamProcessor()\nprocessor.process_piezo_record("good")\n'
            'try: processor.process_piezo_record("bad")\nexcept ValueError: pass\n'
            'processor.process_piezo_record("good")\n')
        self.assertEqual(result.returncode, 0, result.stderr)
        status = json.loads(self.output.read_text())
        self.assertEqual(status['successes'], 2)
        self.assertEqual(status['errors'], 1)
        self.assertTrue(status['fatal'])

    def test_import_hook_detects_upstream_errors_from_a_nonpropagating_logger(self):
        stream = self.root / 'tree/biometrics/stream'
        stream.mkdir(parents=True)
        source = (SCRIPTS / 'tests/fixtures/upstream_calculate_vitals.py').read_text()
        (stream / 'biometric_processor.py').write_text(source + '\n' +
            'import logging, traceback\n'
            'logger = logging.getLogger("upstream-biometrics")\n'
            'logger.propagate = False\nlogger.addHandler(logging.NullHandler())\n'
            'class BadSignalWarning(Exception): pass\n'
            'def interpolate_outliers_in_wave(*args, **kwargs): raise RuntimeError("calculation failed")\n'
            'class BiometricProcessor:\n'
            '    signal_percentile = (1, 99)\n'
            '    _calculate_vitals = _calculate_vitals\n')
        # run_stream creates the directory too; leave its files for the import hook.
        result = self.run_stream(
            'from stream_processor import StreamProcessor\nStreamProcessor().process_piezo_record("bad")\n',
            'from biometric_processor import BiometricProcessor\n'
            'class StreamProcessor:\n'
            '    def process_piezo_record(self, record):\n'
            '        return BiometricProcessor()._calculate_vitals(record, 1)\n')
        self.assertEqual(result.returncode, 0, result.stderr)
        status = json.loads(self.output.read_text())
        self.assertEqual(status['successes'], 0)
        self.assertEqual(status['errors'], 1)

    def test_delayed_import_failure_is_bound_to_launch_and_exits_nonzero(self):
        result = self.run_stream('import time\ntime.sleep(0.01)\nimport nonexistent_dependency\n')
        self.assertNotEqual(result.returncode, 0)
        status = json.loads(self.output.read_text())
        self.assertEqual(status['token'], 'launch-token')
        self.assertTrue(status['fatal'])
        self.assertEqual(status['successes'], 0)

    def test_probe_cannot_reuse_output_from_another_launch(self):
        self.output.write_text('{"token":"old-launch","successes":9999}')
        probe = self.module.Probe(self.output, 'launch-token')
        probe.publish()
        status = json.loads(self.output.read_text())
        self.assertEqual(status['successes'], 0)
        self.assertEqual(status['token'], 'launch-token')


if __name__ == '__main__':
    unittest.main()
