"""db.py loaded against an in-memory database built from the real Prisma migrations.

Loaded under its own module name, so the stub 'db' modules other tests put in
sys.modules are neither used nor disturbed.
"""
import importlib.util
import logging
import os
import sqlite3
import sys
import unittest.mock

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, '..'))

import get_logger as _gl

_gl._get_file_handler = lambda *args: logging.NullHandler()
for _name in _gl.LOGGER_NAMES:
    _gl.get_logger(_name)

MIGRATIONS = os.path.join(HERE, '..', '..', 'server', 'prisma', 'migrations')


def load_db_module(name='db_on_migrations'):
    real_connect = sqlite3.connect
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, '..', 'db.py'))
    module = importlib.util.module_from_spec(spec)
    with unittest.mock.patch('sqlite3.connect', lambda *a, **k: real_connect(':memory:', isolation_level=None)):
        spec.loader.exec_module(module)
    for folder in sorted(os.listdir(MIGRATIONS)):
        path = os.path.join(MIGRATIONS, folder, 'migration.sql')
        if os.path.exists(path):
            with open(path) as handle:
                module.conn.executescript(handle.read())
    return module
