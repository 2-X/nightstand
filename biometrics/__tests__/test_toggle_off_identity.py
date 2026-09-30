"""With the new sleep tracking off, the analyzer and the live stream must
produce exactly what they produced before capacitance presence existed.

The golden file was written by that earlier code from the synthetic nights
presence_scenarios.STAGGERED and INTERIOR_EXIT. Regenerate it only for a change that is meant
to alter these outputs for everyone:
    python3 biometrics/__tests__/test_toggle_off_identity.py --write-golden
"""
import hashlib
import json
import logging
import os
import sys
import tempfile
import types
import unittest
import unittest.mock
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
sys.path.insert(0, os.path.join(HERE, '..', 'sleep_detection'))
sys.path.insert(0, os.path.join(HERE, '..', 'stream'))
sys.path.insert(0, HERE)

try:
    import scipy.interpolate  # noqa: F401
    import scipy.signal  # noqa: F401
except ImportError:
    # Same stub shape as the other stream tests: whichever imports first wins.
    _scipy = types.ModuleType('scipy')
    _scipy_interpolate = types.ModuleType('scipy.interpolate')
    _scipy_signal = types.ModuleType('scipy.signal')
    _scipy_interpolate.UnivariateSpline = object
    for _fn in ('welch', 'periodogram', 'butter', 'filtfilt', 'iirnotch', 'savgol_filter'):
        setattr(_scipy_signal, _fn, lambda *a, **k: None)
    _scipy.interpolate = _scipy_interpolate
    _scipy.signal = _scipy_signal
    sys.modules.setdefault('scipy', _scipy)
    sys.modules.setdefault('scipy.interpolate', _scipy_interpolate)
    sys.modules.setdefault('scipy.signal', _scipy_signal)

# biometric_processor binds insert_vitals at import. Only add it: another test
# may already have installed a db stub with a different slice of its surface.
_db = sys.modules.setdefault('db', types.ModuleType('db'))
if not hasattr(_db, 'insert_vitals'):
    _db.insert_vitals = lambda *a, **k: None

import get_logger as _gl

_gl._get_file_handler = lambda data_folder_path, name: logging.NullHandler()
from get_logger import get_logger, LOGGER_NAMES

for _logger_name in LOGGER_NAMES:
    get_logger(_logger_name)

import biometric_processor
import load_raw_files
import sleep_detector
from biometric_processor import BiometricProcessor, _PresenceCoordinator
from load_raw_files import load_piezo_row
from stream_processor import StreamProcessor

import presence_scenarios as scenarios

GOLDEN_PATH = os.path.join(HERE, 'fixtures', 'toggle_off_golden.json')
FLOAT_DIGITS = 6


def _record_json(value):
    if isinstance(value, datetime):
        return value.isoformat()
    raise TypeError(type(value))


def _fake_vitals(self, signal, epoch, update_breathing=False, update_hrv=False):
    """Deterministic stand-in for the heartpy estimate; presence and gating are what is pinned."""
    if update_breathing:
        self.breathing_rate = 14.0
    if update_hrv:
        self.hrv = 45.0
    return {
        'side': self.side, 'timestamp': epoch, 'heart_rate': 60.0 + epoch % 5,
        'hrv': self.hrv, 'breathing_rate': self.breathing_rate,
    }


def _frame_summary(frame) -> dict:
    """Row count and column sums, to show what moved when the frame hash no longer matches."""
    numeric = frame.select_dtypes(include='number')
    return {
        'rows': len(frame),
        'sums': {column: round(float(numeric[column].sum()), 3) for column in sorted(numeric.columns)},
    }


def run_analyzer(side: str, night: scenarios.Night = scenarios.STAGGERED) -> dict:
    with tempfile.TemporaryDirectory() as folder:
        scenarios.write_raw_file(os.path.join(folder, 'night.RAW'), scenarios.raw_records(night))
        start = datetime.fromtimestamp(scenarios.T0, timezone.utc) - timedelta(minutes=1)
        end = start + timedelta(seconds=night.seconds + 120)
        baseline = {
            f'{side}_{channel}': {'mean': mean, 'std': 1}
            for channel, mean in zip(('out', 'cen', 'in'), scenarios.BASELINE_MEANS[side])
        }
        # The data folder's raw-archive is scanned too; point it at the empty temp folder.
        with unittest.mock.patch.object(load_raw_files.logger, 'folder_path', os.path.join(folder, '')), \
                unittest.mock.patch.object(sleep_detector, 'load_baseline', return_value=baseline), \
                unittest.mock.patch.object(sleep_detector, 'biometrics_v2_enabled', return_value=False, create=True):
            merged_df, records, _ = sleep_detector.detect_sleep(side, start, end, folder)
    frame_csv = merged_df.to_csv(float_format='%.6f').encode()
    return {
        'records': json.loads(json.dumps(records, default=_record_json)),
        'frame_sha256': hashlib.sha256(frame_csv).hexdigest(),
        'frame_summary': _frame_summary(merged_df),
    }


def run_stream(night: scenarios.Night = scenarios.STAGGERED) -> dict:
    saved_latest = _PresenceCoordinator._latest
    _PresenceCoordinator._latest = {'left': 0.0, 'right': 0.0}
    posts, inserts, tick = [], [], [0]

    def capture_post(self, is_present):
        posts.append([tick[0], self.side, is_present])

    def capture_insert(row):
        inserts.append([
            row['side'], row['timestamp'],
            *(round(row[key], FLOAT_DIGITS) for key in ('heart_rate', 'hrv', 'breathing_rate')),
        ])

    records = [
        record for record in scenarios.raw_records(night)
        if record['type'] == 'piezo-dual'
    ]
    for record in records:
        load_piezo_row(record, 'right')
    try:
        with unittest.mock.patch.object(BiometricProcessor, '_update_presence_api', capture_post), \
                unittest.mock.patch.object(BiometricProcessor, '_calculate_vitals', _fake_vitals), \
                unittest.mock.patch.object(biometric_processor, 'insert_vitals', side_effect=capture_insert):
            processor = StreamProcessor(records[0])
            for tick[0], record in enumerate(records[1:], start=1):
                processor.process_piezo_record(record)
    finally:
        _PresenceCoordinator._latest = saved_latest
    return {'posts': posts, 'inserts': inserts}


def build_golden() -> dict:
    return {
        'analyzer': {side: run_analyzer(side) for side in ('left', 'right')},
        'analyzer_interior_exit': {
            side: run_analyzer(side, scenarios.INTERIOR_EXIT) for side in ('left', 'right')
        },
        'stream': run_stream(),
        'stream_interior_exit': run_stream(scenarios.INTERIOR_EXIT),
    }


class ToggleOffIdentityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(GOLDEN_PATH) as handle:
            cls.golden = json.load(handle)

    def test_analyzer_output_is_unchanged(self):
        for side in ('left', 'right'):
            with self.subTest(side=side):
                self.assertEqual(run_analyzer(side), self.golden['analyzer'][side])

    def test_analyzer_output_with_interior_exits_is_unchanged(self):
        for side in ('left', 'right'):
            with self.subTest(side=side):
                self.assertEqual(
                    run_analyzer(side, scenarios.INTERIOR_EXIT), self.golden['analyzer_interior_exit'][side])

    def test_stream_output_is_unchanged(self):
        self.assertEqual(run_stream(), self.golden['stream'])

    def test_stream_output_with_interior_exits_is_unchanged(self):
        self.assertEqual(run_stream(scenarios.INTERIOR_EXIT), self.golden['stream_interior_exit'])


if __name__ == '__main__':
    if '--write-golden' in sys.argv:
        os.makedirs(os.path.dirname(GOLDEN_PATH), exist_ok=True)
        with open(GOLDEN_PATH, 'w') as handle:
            json.dump(build_golden(), handle, indent=1, sort_keys=True)
            handle.write('\n')
        print(f'wrote {GOLDEN_PATH}')
    else:
        unittest.main()
