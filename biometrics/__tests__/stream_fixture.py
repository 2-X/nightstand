"""A deterministic two-side piezo stream run through StreamProcessor.

The left side carries a heartbeat and breathing; the right side is an empty
bed. Rows land, through the real db.insert_vitals, in an in-memory database
built from the real migrations.
"""
import os
import sys
import types
import unittest.mock

import numpy as np

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, '..'))
sys.path.insert(0, os.path.join(HERE, '..', 'stream'))
sys.path.insert(0, HERE)

import migrated_db  # noqa: F401  (quiet loggers before the stream modules load)

_db_stub = types.ModuleType('db')
_db_stub.insert_vitals = lambda *args, **kwargs: None
sys.modules.setdefault('db', _db_stub)

import biometric_processor
import stream_processor
from vitals2_synth import piezo

START = 1_790_600_400


def records(seconds=480, seed=7):
    left = piezo(seconds, bpm=58, per_minute=14, jitter_ms=20, seed=seed)
    right = (np.random.default_rng(seed + 100).normal(0, 20_000, left.size) + 300_000).astype(np.int32)
    for second in range(seconds):
        window = slice(second * 500, (second + 1) * 500)
        yield {'type': 'piezo-dual', 'ts': START + second, 'freq': 500, 'adc': 65, 'gain': 400,
               'left1': left[window].copy(), 'right1': right[window].copy(), 'seq': second}


def run_stream(db_module, seconds=480, v2=False):
    """Feed the fixture through StreamProcessor with the vitals switch as given; return the database module.

    Presence is the piezo detector throughout (no capacitance source), as on a
    Pod without capacitance records or with the switch off.
    """
    biometric_processor._PresenceCoordinator._latest = {'left': 0.0, 'right': 0.0}
    patches = [
        unittest.mock.patch.object(biometric_processor.BiometricProcessor, '_update_presence_api',
                                   lambda self, present: None),
        unittest.mock.patch.object(biometric_processor, 'insert_vitals', db_module.insert_vitals),
    ]
    if hasattr(stream_processor, 'insert_vitals'):
        patches.append(unittest.mock.patch.object(stream_processor, 'insert_vitals', db_module.insert_vitals))
    for patch in patches:
        patch.start()
    try:
        processor = None
        for record in records(seconds):
            if processor is None:
                processor = stream_processor.StreamProcessor(record)
                # Task 11 adds the method; before it, only the legacy path exists.
                if hasattr(processor, 'use_vitals_v2'):
                    processor.use_vitals_v2(v2)
                elif v2:
                    raise RuntimeError('StreamProcessor has no use_vitals_v2 yet')
            processor.process_piezo_record(record)
    finally:
        for patch in patches:
            patch.stop()
    return db_module


def legacy_rows(db_module):
    return [list(row) for row in db_module.conn.execute(
        'SELECT side, timestamp, heart_rate, hrv, breathing_rate FROM vitals ORDER BY side, timestamp')]
