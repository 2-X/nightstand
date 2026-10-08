#!/usr/bin/env python3
"""Import staged application modules without starting services or touching data.

Exercise the real logger and database modules, replacing logger initialization
and redirecting SQLite to memory. No stream entry point is run. Audit guards
deny network, child processes, live-tree reads, and writes outside scratch.
"""
import importlib
import importlib.util
import logging
import os
from pathlib import Path
import sqlite3
import sys
import threading


def validate(stage, scratch):
    stage, scratch = Path(stage).resolve(), Path(scratch).resolve()
    biometrics = stage / 'biometrics'
    if not biometrics.is_dir() or not scratch.is_dir():
        raise ValueError('Missing staged biometrics or scratch directory')
    sys.dont_write_bytecode = True
    roots = [biometrics, biometrics / 'stream', biometrics / 'sleep_detection']
    sys.path[:0] = [str(path) for path in roots]
    os.chdir(str(biometrics))

    def audit(event, arguments):
        if event in ('socket.connect', 'socket.bind', 'socket.sendto', 'socket.getaddrinfo', 'subprocess.Popen', 'os.system', 'os.fork', 'os.posix_spawn'):
            raise RuntimeError('External side effect during import validation: ' + event)
        if event == 'open' and isinstance(arguments[0], (str, bytes, os.PathLike)):
            lexical = Path(os.fsdecode(arguments[0])).absolute()
            path = lexical.resolve()
            forbidden = (Path('/home/dac/free-sleep'), Path('/persistent'))
            if any(root == lexical or root in lexical.parents or root == path or root in path.parents for root in forbidden):
                if stage != path and stage not in path.parents:
                    raise RuntimeError('Live data read during import validation: ' + str(path))
            flags = arguments[2]
            if flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND):
                if scratch not in path.parents and path != Path('/dev/null'):
                    raise RuntimeError('Write outside import scratch: ' + str(path))
        if event in ('os.remove', 'os.rename', 'os.mkdir', 'os.rmdir', 'os.symlink', 'os.link'):
            raise RuntimeError('Filesystem mutation during import validation: ' + event)

    sys.addaudithook(audit)
    def deny_thread_start(*args, **kwargs):
        raise RuntimeError('Background worker during import validation')
    threading.Thread.start = deny_thread_start
    for dependency in ('numpy', 'scipy', 'pandas', 'cbor2', 'watchdog', 'sentry_sdk', 'nats', 'nats.js.api'):
        importlib.import_module(dependency)
    logger_module = importlib.import_module('get_logger')
    def build_logger(logger, name):
        logger.folder_path = str(scratch) + '/'
        logger.env = 'local'
        logger.addHandler(logging.NullHandler())
    logger_module._build_logger = build_logger
    logger_module._init_sentry = lambda: None
    logger_module.get_logger('free-sleep-stream')
    connect = sqlite3.connect
    sqlite3.connect = lambda *args, **kwargs: connect(':memory:', **kwargs)
    for module in ('stream_processor', 'load_raw_files', 'sleep_detection.sleep_detector', 'service_health', 'nats_client'):
        importlib.import_module(module)
    stream_path = biometrics / 'stream/stream.py'
    spec = importlib.util.spec_from_file_location('_upstream_validation_stream', str(stream_path))
    stream = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(stream)
    for name, module in list(sys.modules.items()):
        filename = getattr(module, '__file__', None)
        if filename:
            path = Path(filename).resolve()
            if '/biometrics/' in str(path) and biometrics not in path.parents:
                raise RuntimeError('Application import resolved outside staged tree: ' + name)
    for module in ('get_logger', 'db', 'stream_processor', 'load_raw_files', 'sleep_detection.sleep_detector'):
        path = Path(sys.modules[module].__file__).resolve()
        if biometrics not in path.parents:
            raise RuntimeError('Missing staged application import: ' + module)
    print('Staged upstream application imports passed')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('Expected staged tree and scratch paths')
    validate(*sys.argv[1:])
