#!/usr/bin/env python3
"""Launch an unchanged upstream stream with transaction-bound processing evidence.

The temporary service override must use this wrapper as its main process. Remove
that override with daemon-reload after validation, without restarting the stream.
Keep this file and its output outside the replaceable application checkout.
"""
import argparse
import functools
import importlib.abc
import importlib.machinery
import json
import logging
import os
from pathlib import Path
import re
import runpy
import sys
import tempfile
import threading
import time


def process_start_ticks(pid):
    # Field 22 follows a parenthesized command name that may contain spaces.
    text = (Path('/proc') / str(pid) / 'stat').read_text()
    return int(text.rsplit(')', 1)[1].split()[19])


class Probe:
    def __init__(self, output, token, clock=time.monotonic):
        if not isinstance(token, str) or re.fullmatch(r'[A-Za-z0-9_-]{8,128}', token) is None:
            raise ValueError('Invalid launch token')
        self.output = Path(output)
        self.clock = clock
        self.lock = threading.Lock()
        self.worker = None
        try:
            ticks = process_start_ticks(os.getpid())
        except FileNotFoundError:
            ticks = 0  # Non-Linux fixtures cannot supply usable readiness evidence.
        self.state = dict(schemaVersion=1, token=token, pid=os.getpid(), procStartTicks=ticks,
                          launched=clock(), launchedWall=time.time(), successes=0,
                          lastSuccess=None, errors=0, fatal=False)

    def instrument(self, processor, loggers=()):
        context = threading.local()
        class ProcessingErrors(logging.Handler):
            def emit(self, record):
                if record.levelno >= logging.ERROR and getattr(context, 'processing', False):
                    context.failed = True
        handler = ProcessingErrors()
        targets = set(loggers) | {logging.getLogger()}
        for logger in targets:
            logger.addHandler(handler)
        original = processor.process_piezo_record
        @functools.wraps(original)
        def process(instance, *arguments, **keywords):
            with self.lock:
                self.worker = threading.current_thread()
            context.processing, context.failed = True, False
            try:
                result = original(instance, *arguments, **keywords)
            except BaseException:
                with self.lock:
                    self.state['errors'] += 1
                raise
            finally:
                context.processing = False
            with self.lock:
                if context.failed:
                    self.state['errors'] += 1
                else:
                    self.state['successes'] += 1
                    self.state['lastSuccess'] = self.clock()
            return result
        processor.process_piezo_record = process

    def publish(self):
        with self.lock:
            value = dict(self.state, heartbeat=self.clock(),
                         workerAlive=self.worker is not None and self.worker.is_alive())
            # Serialize heartbeat and final publication so fatal cannot be overwritten.
            descriptor, temporary = tempfile.mkstemp(prefix='.stream-probe-', dir=str(self.output.parent))
            try:
                with os.fdopen(descriptor, 'w') as handle:
                    json.dump(value, handle, sort_keys=True, allow_nan=False)
                    handle.write('\n')
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary, str(self.output))
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)


class ProcessorImport(importlib.abc.MetaPathFinder):
    def __init__(self, probe, stream_directory):
        self.probe = probe
        self.directory = stream_directory

    def find_spec(self, fullname, path=None, target=None):
        if fullname != 'stream_processor':
            return None
        spec = importlib.machinery.PathFinder.find_spec(fullname, path)
        if spec is None or Path(spec.origin).resolve() != self.directory / 'stream_processor.py':
            raise ImportError('Stream processor did not resolve to the selected upstream tree')
        original = spec.loader
        probe = self.probe
        class Loader(importlib.abc.Loader):
            def create_module(self, specification):
                return original.create_module(specification)

            def exec_module(self, module):
                original.exec_module(module)
                loggers = [getattr(module, 'logger', logging.getLogger())]
                biometric = getattr(module, 'BiometricProcessor', None)
                if biometric is not None:
                    imported = sys.modules.get(biometric.__module__)
                    loggers.append(getattr(imported, 'logger', logging.getLogger()))
                probe.instrument(module.StreamProcessor, loggers=loggers)
        spec.loader = Loader()
        return spec


def launch(tree, output, token):
    directory = Path(tree).resolve() / 'biometrics/stream'
    entry = directory / 'stream.py'
    if not entry.is_file() or 'stream_processor' in sys.modules:
        raise ValueError('Missing stream entry point or already imported processor')
    probe = Probe(output, token)
    probe.publish()
    sys.path[:0] = [str(directory), str(directory.parent)]
    finder = ProcessorImport(probe, directory)
    sys.meta_path.insert(0, finder)
    stopped = threading.Event()
    def heartbeat():
        while not stopped.wait(1):
            probe.publish()
    thread = threading.Thread(target=heartbeat, daemon=True, name='upstream-launch-probe')
    thread.start()
    original_hook = threading.excepthook
    def failed_thread(arguments):
        with probe.lock:
            probe.state['errors'] += 1
        probe.publish()
        original_hook(arguments)
    threading.excepthook = failed_thread
    try:
        runpy.run_path(str(entry), run_name='__main__')
    finally:
        stopped.set()
        thread.join(timeout=2)
        with probe.lock:
            probe.state['fatal'] = True
        probe.publish()
        threading.excepthook = original_hook
        sys.meta_path.remove(finder)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tree', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--launch-token', required=True)
    args = parser.parse_args()
    launch(args.tree, args.output, args.launch_token)


if __name__ == '__main__':
    main()
