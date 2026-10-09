"""With the new sleep tracking on, a Pod 5 writing capSense2 must keep
producing exactly what it produced before other capacitance formats were read.

Pinned: the analyzer's records, frames and learned levels, the live stream's
presence transitions and the timing of its vitals inserts (the vitals values
themselves are stubbed, so only when a row is written is checked), the
resolved detector parameters, and the capacitance delta of a corpus of raw
rows. One graded night with baseline drift and capacitance gaps puts the
detector's entry levels, tracking limit, alive count and capacitance hold
on the line, not only its step-shaped nights.

The golden file was written by that earlier code. Regenerate it only for a
change that is meant to alter the new tracking on a Pod 5:
    python3 biometrics/__tests__/test_presence_v2_identity.py --write-golden
"""
import dataclasses
import json
import math
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# Each sets up paths, loggers and stubs the way its own tests need.
import test_stream_presence as live
import test_sleep_detector_presence as nightly

import numpy as np

import presence_scenarios as scenarios
from presence.cap import CapBaseline, cap_delta
from presence.params import baselines_from_calibration, params_from_calibration
from presence.sensors import read_cap

GOLDEN_PATH = os.path.join(HERE, 'fixtures', 'presence_v2_golden.json')
# Occupied rises a Pod has learned: the left entry level lands just under the
# ceiling, the right one under the floor.
LEARNED = {'left': 24.0, 'right': 7.0}
DELTA_BASELINE = CapBaseline(mean=(12.4, 9.9, 14.5), noise=0.05)


# The graded night: baseline drift on the left, then short visits whose
# capacitance rise sits just either side of an entry level, plus visits with
# few piezo-alive seconds and with holes in the capacitance records.
GRADED_SECONDS = 9800
DRIFT = 3.8
DRIFT_RAMP_SECONDS = 2000
# The drift settles at the tracking limit, so a left rise reads 0.8 higher than it is.
# (side, start, rise, piezo-alive seconds at the start or None, seconds without a record, sentinel seconds)
VISITS = (
    ('left', 3300, 3.0, None, (), ()),
    ('left', 3800, 3.5, None, (), ()),
    ('left', 4300, 8.5, None, (), ()),
    ('left', 4800, 9.0, None, (), ()),
    ('right', 5300, 4.1, None, (), ()),
    ('right', 5800, 3.7, None, (), ()),
    ('right', 6300, 3.1, None, (), ()),
    ('right', 6800, 2.9, None, (), ()),
    ('right', 7300, 15.0, range(3, 8), (), ()),
    ('right', 7800, 15.0, range(3, 7), (), ()),
    ('right', 8300, 15.0, None, range(8, 14), ()),
    ('right', 8800, 15.0, None, range(8, 13), ()),
    ('right', 9300, 15.0, None, (), range(8, 15)),
)
VISIT_SECONDS = 200


def _visit_at(second):
    for visit in VISITS:
        if visit[1] <= second < visit[1] + VISIT_SECONDS:
            return visit
    return None


def _graded_rise(side, second):
    visit = _visit_at(second)
    rise = 0.0
    if side == 'left':
        rise += DRIFT * min(1.0, second / DRIFT_RAMP_SECONDS)
    if visit is not None:
        rise += visit[2] if visit[0] == side else 0.5
    return rise


def _graded_piezo(side, second):
    visit = _visit_at(second)
    if visit is None:
        return 40_000.0
    own = 5_000_000.0 if visit[0] == 'left' else 1_500_000.0
    if visit[3] is not None:
        return own if side == visit[0] and second - visit[1] in visit[3] else 40_000.0
    return own if side == visit[0] else 0.6 * own


def graded_records():
    """Raw records for the graded night: two capSense2 per second, fewer where a visit has holes."""
    cap_index = 0
    for second in range(GRADED_SECONDS):
        piezo = {side: scenarios.piezo_samples(_graded_piezo(side, second)) for side in scenarios.SIDES}
        yield {
            'type': 'piezo-dual', 'ts': scenarios.T0 + second, 'freq': 500, 'adc': 1, 'gain': 400,
            'left1': piezo['left'], 'left2': piezo['left'], 'right1': piezo['right'], 'right2': piezo['right'],
            'seq': second,
        }
        visit = _visit_at(second)
        offset = 0 if visit is None else second - visit[1]
        if visit is not None and offset in visit[4]:
            continue
        for _ in range(2):
            sides = {}
            for side in scenarios.SIDES:
                if (visit is not None and offset in visit[5]) or cap_index % scenarios.SENTINEL_EVERY == scenarios.SENTINEL_EVERY - 1:
                    values = [-1.0] * 8
                else:
                    rise = _graded_rise(side, second) / 3
                    values = [mean + rise for mean in scenarios.BASELINE_MEANS[side] for _ in range(2)]
                    values += [scenarios.REFERENCE_VALUE] * 2
                sides[side] = {'values': values, 'status': 'good'}
            yield {'type': 'capSense2', 'ts': scenarios.T0 + second, 'version': 1, **sides}
            cap_index += 1


def pod5_delta(values, baseline):
    """The capacitance delta of one side's raw capSense2 values."""
    reading = read_cap({'type': 'capSense2', 'left': {'values': values}, 'right': {'values': values}})
    return cap_delta(reading.left, baseline)


def corpus():
    """capSense2 rows shaped like real ones, with every kind of missing value the Pod writes."""
    rng = np.random.default_rng(20260930)
    rows = []
    for index in range(3000):
        values = [float(value) for value in rng.normal(14.0, 4.0, 6)] + [1.18, 1.17]
        kind = index % 10
        if kind == 0:
            values = [-1.0] * 8
        elif kind in (1, 2):
            values[int(rng.integers(0, 6))] = -1.0
        elif kind == 3:
            values[0] = values[1] = -1.0
        elif kind == 4:
            values[int(rng.integers(0, 6))] = float('nan')
        rows.append(values)
    return rows


def _learned_profiles():
    presence = nightly.profiles()
    for side in ('left', 'right'):
        presence[side]['cap_occupied'] = {'level': LEARNED[side], 'provenance': {'format': 'capSense2', 'normalizationVersion': 1}}
    return presence


def _jsonable(value):
    return json.loads(json.dumps(value, default=lambda item: item.isoformat()))


# name: (records, seconds)
SOURCES = {
    'staggered': (lambda: scenarios.raw_records(scenarios.STAGGERED), scenarios.STAGGERED.seconds),
    'interior_exit': (lambda: scenarios.raw_records(scenarios.INTERIOR_EXIT), scenarios.INTERIOR_EXIT.seconds),
    'graded': (graded_records, GRADED_SECONDS),
}


def _profile_sets():
    return (('default', nightly.profiles()), ('learned', _learned_profiles()))


def run_analyzer():
    out = {}
    for name, (records_of, seconds) in SOURCES.items():
        for label, presence in _profile_sets():
            for side in ('left', 'right'):
                records, frame_hash, stored = nightly.analyze(
                    side, records_of(), True, presence, window=(-60, seconds + 60))
                out[f'{name}/{label}/{side}'] = {
                    'records': nightly.as_json(records), 'frame_sha256': frame_hash, 'stored': _jsonable(stored),
                }
    return out


def run_stream():
    default, learned = (params_from_calibration(presence) for _, presence in _profile_sets())
    baselines = baselines_from_calibration(nightly.profiles())
    inputs = {
        'fixed': (live.PARAMS, live.BASELINES),
        'calibrated': (default, baselines),
        'learned': (learned, baselines),
    }
    out = {}
    for name, (records_of, _) in SOURCES.items():
        for label, args in inputs.items():
            transitions, inserts = live.stream(None, inputs=args, records=records_of())
            out[f'{name}/{label}'] = {'transitions': _jsonable(transitions), 'inserts': _jsonable(inserts)}
    return out


# SideParams fields added after the golden was written, with the value a
# capSense2 side must keep. They are checked here, not in the golden.
ADDED_SIDE_FIELDS = {'offset_limit': 3.0}


def _detector_as_written(params):
    detector = dataclasses.asdict(params)
    for side in ('left', 'right'):
        for name in ADDED_SIDE_FIELDS:
            del detector[side][name]
    return detector


def run_params():
    return {
        label: {
            'detector': _jsonable(_detector_as_written(params_from_calibration(presence))),
            'baselines': _jsonable({side: dataclasses.asdict(b) for side, b in baselines_from_calibration(presence).items()}),
        }
        for label, presence in _profile_sets()
    }


def run_cap_delta():
    deltas = [pod5_delta(values, DELTA_BASELINE) for values in corpus()]
    return [None if delta is None else float(delta).hex() for delta in deltas]


def build_golden() -> dict:
    return {'analyzer': run_analyzer(), 'stream': run_stream(), 'params': run_params(), 'cap_delta': run_cap_delta()}


class Pod5IdentityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(GOLDEN_PATH) as handle:
            cls.golden = json.load(handle)

    def test_the_corpus_holds_every_kind_of_missing_value(self):
        rows = corpus()
        self.assertTrue(any(row[:6] == [-1.0] * 6 for row in rows))
        self.assertTrue(any(any(math.isnan(value) for value in row) for row in rows))
        # Only the rows with no reading at all (every tenth) give None. A row
        # with some values missing still gives a delta: a pair falls back to its
        # other value, and a channel with both missing, as in the rows where
        # the first two values are gone, is left out and the others scaled up.
        self.assertEqual(sum(1 for delta in self.golden['cap_delta'] if delta is None), 300)

    def test_resolved_detector_parameters_are_the_same(self):
        self.assertEqual(run_params(), self.golden['params'])

    def test_added_side_fields_keep_their_capsense2_values(self):
        for label, presence in _profile_sets():
            params = params_from_calibration(presence)
            for side in ('left', 'right'):
                with self.subTest(params=f'{label}/{side}'):
                    side_params = params.for_side(side)
                    self.assertEqual({name: getattr(side_params, name) for name in ADDED_SIDE_FIELDS}, ADDED_SIDE_FIELDS)

    def test_capacitance_deltas_are_bit_for_bit_the_same(self):
        self.assertEqual(run_cap_delta(), self.golden['cap_delta'])

    def test_analyzer_records_frames_and_levels_are_the_same(self):
        result = run_analyzer()
        for key, expected in self.golden['analyzer'].items():
            with self.subTest(run=key):
                self.assertEqual(result[key], expected)

    def test_live_presence_and_vitals_insert_timing_are_the_same(self):
        result = run_stream()
        for key, expected in self.golden['stream'].items():
            with self.subTest(run=key):
                self.assertEqual(result[key], expected)


if __name__ == '__main__':
    if '--write-golden' in sys.argv:
        os.makedirs(os.path.dirname(GOLDEN_PATH), exist_ok=True)
        with open(GOLDEN_PATH, 'w') as handle:
            json.dump(build_golden(), handle, indent=1, sort_keys=True)
            handle.write('\n')
        print(f'wrote {GOLDEN_PATH}')
    else:
        unittest.main(argv=sys.argv[:1])
