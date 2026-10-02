"""A deterministic two-side piezo stream run through StreamProcessor.

The left side carries a heartbeat and breathing; the right side is an empty
bed. Rows land, through the real db.insert_vitals, in an in-memory database
built from the real migrations. With capacitance, a capSense2 reading a
second behind each piezo record shows the left side occupied and the right
side empty.
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
from presence.cap import CapBaseline
from presence.detector import DetectorParams, SideParams
from presence.sensors import CAPSENSE2
from vitals2_synth import piezo

START = 1_790_600_400
# The stream hands presence back to piezo once the newest reading is older than this.
CAP_FRESH_SECONDS = 60
PARAMS = DetectorParams(left=SideParams(enter_delta=8.0, exit_delta=4.0),
                        right=SideParams(enter_delta=4.0, exit_delta=2.0),
                        piezo_floor={'left': 40_000.0, 'right': 70_000.0})
BASELINE = (10.0, 10.0, 10.0)
BASELINES = {side: CapBaseline(mean=BASELINE, noise=0.05) for side in ('left', 'right')}
# Spread over the three channels, a rise of 20 on the left; the right stays at its baseline.
LEFT_CHANNELS = tuple(mean + 20.0 / 3 for mean in BASELINE)


def records(seconds=480, seed=7):
    left = piezo(seconds, bpm=58, per_minute=14, jitter_ms=20, seed=seed)
    right = (np.random.default_rng(seed + 100).normal(0, 20_000, left.size) + 300_000).astype(np.int32)
    for second in range(seconds):
        window = slice(second * 500, (second + 1) * 500)
        yield {'type': 'piezo-dual', 'ts': START + second, 'freq': 500, 'adc': 65, 'gain': 400,
               'left1': left[window].copy(), 'right1': right[window].copy(), 'seq': second}


def run_stream(db_module, seconds=480, v2=False, capacitance=False):
    """Feed the fixture through StreamProcessor with the vitals switch as given; return the database module.

    Without capacitance, presence is the piezo detector throughout, as on a
    Pod without capacitance records or with the switch off. capacitance=True
    puts the capacitance detector in charge from the first record; a (start,
    stop) pair of seconds sends readings only in that span, hands presence to
    the capacitance detector at start, and back to piezo once the newest
    reading is more than CAP_FRESH_SECONDS old, as the stream does.
    """
    span = (0, None) if capacitance is True else capacitance
    biometric_processor._PresenceCoordinator._latest = {'left': 0.0, 'right': 0.0}
    patches = [
        unittest.mock.patch.object(biometric_processor.BiometricProcessor, '_update_presence_api',
                                   lambda self, present: None),
        unittest.mock.patch.object(biometric_processor, 'insert_vitals', db_module.insert_vitals),
        unittest.mock.patch.object(stream_processor, 'insert_vitals', db_module.insert_vitals),
    ]
    for patch in patches:
        patch.start()
    try:
        processor = None
        latest = stream_processor.LatestCap() if span else None
        for second, record in enumerate(records(seconds)):
            if span and second >= span[0] and (span[1] is None or second < span[1]):
                latest.update(record['ts'] - 1, LEFT_CHANNELS, BASELINE, CAPSENSE2)
            if processor is None:
                processor = stream_processor.StreamProcessor(record, cap_source=latest)
                processor.use_vitals_v2(v2)
            if span and second == span[0]:
                processor.use_presence_v2((PARAMS, BASELINES))
            if span and span[1] is not None and second == span[1] + CAP_FRESH_SECONDS:
                processor.use_presence_v2(None)
            processor.process_piezo_record(record)
    finally:
        for patch in patches:
            patch.stop()
    return db_module


def legacy_rows(db_module):
    return [list(row) for row in db_module.conn.execute(
        'SELECT side, timestamp, heart_rate, hrv, breathing_rate FROM vitals ORDER BY side, timestamp')]
