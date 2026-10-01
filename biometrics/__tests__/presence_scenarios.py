"""Synthetic two-sided nights shaped like real ones, for presence tests.

Left is the heavier sleeper (capacitance rise about 20), right the lighter
one (about 10). A side next to an occupied one reads a small capacitance
rise with short spikes, and its piezo picks up the partner through the frame.
Times are whole seconds from the start of the night.
"""
from dataclasses import dataclass
from typing import Dict, Iterator, List, Optional, Tuple

import cbor2
import numpy as np

from presence.sensors import read_cap

# 2026-09-28 04:00:00 UTC, 21:00 Pacific.
T0 = 1790568000
SIDES = ('left', 'right')
BASELINE_MEANS = {'left': (11.36, 9.99, 14.88), 'right': (12.48, 9.87, 14.46)}
# Counts shaped like the one published capSense sample (out, cen, in).
LEGACY_COUNTS = {'left': (387, 381, 505), 'right': (1076, 1075, 1074)}
REFERENCE_VALUE = 1.2
SPIKE_PERIOD = 97
SPIKE_SECONDS = 5
SENTINEL_EVERY = 500
PIEZO_SAMPLES = 10


@dataclass(frozen=True)
class Night:
    seconds: int
    left: Tuple[Tuple[int, int], ...] = ()
    right: Tuple[Tuple[int, int], ...] = ()
    levels: Tuple[float, float] = (20.0, 10.0)
    piezo: Tuple[float, float] = (5_000_000.0, 1_500_000.0)
    empty_piezo: float = 40_000.0
    crosstalk: float = 0.6
    partner_cap: float = 0.5
    spike_cap: float = 3.0
    # (side, start, end, level): capacitance forced to level in [start, end)
    overrides: Tuple[Tuple[str, int, int, float], ...] = ()

    def occupied(self, side: str, second: int) -> bool:
        return any(start <= second < end for start, end in getattr(self, side))


def _other(side: str) -> str:
    return 'right' if side == 'left' else 'left'


def cap_level(night: Night, side: str, second: int) -> float:
    for override_side, start, end, level in night.overrides:
        if override_side == side and start <= second < end:
            return level
    if night.occupied(side, second):
        return night.levels[SIDES.index(side)]
    if night.occupied(_other(side), second):
        spike = night.spike_cap if second % SPIKE_PERIOD < SPIKE_SECONDS else 0.0
        return night.partner_cap + spike
    return 0.0


def piezo_level(night: Night, side: str, second: int) -> float:
    if night.occupied(side, second):
        return night.piezo[SIDES.index(side)]
    other = _other(side)
    if night.occupied(other, second):
        return night.crosstalk * night.piezo[SIDES.index(other)]
    return night.empty_piezo


def frames(night: Night, t0: int = T0) -> List[tuple]:
    """Per-second detector inputs: (unix seconds, cap delta per side, piezo range per side)."""
    return [
        (
            t0 + second,
            {side: cap_level(night, side, second) for side in SIDES},
            {side: piezo_level(night, side, second) for side in SIDES},
        )
        for second in range(night.seconds)
    ]


def cap_values(night: Night, side: str, second: int, record_index: int) -> List[float]:
    """One side's eight capSense2 values; every SENTINEL_EVERY-th record carries the no-reading sentinel."""
    if record_index % SENTINEL_EVERY == SENTINEL_EVERY - 1:
        return [-1.0] * 8
    rise = cap_level(night, side, second) / 3
    values: List[float] = []
    for mean in BASELINE_MEANS[side]:
        values += [mean + rise, mean + rise]
    return values + [REFERENCE_VALUE, REFERENCE_VALUE]


def channels(values):
    """One side's channels from raw capSense2 values, as the loader and the stream read them."""
    return read_cap({'type': 'capSense2', 'left': {'values': values}, 'right': {'values': values}}).left


def piezo_samples(amplitude: float) -> bytes:
    """Samples whose p98-p2 range equals amplitude."""
    return np.array([0, int(amplitude)] * (PIEZO_SAMPLES // 2), dtype=np.int32).tobytes()


def raw_records(night: Night, t0: int = T0, start: int = 0, end: Optional[int] = None) -> Iterator[Dict]:
    """Decoded RAW records, one piezo-dual and two capSense2 per second, in time order."""
    end = night.seconds if end is None else end
    cap_index = 0
    for second in range(start, end):
        left = piezo_samples(piezo_level(night, 'left', second))
        right = piezo_samples(piezo_level(night, 'right', second))
        yield {
            'type': 'piezo-dual', 'ts': t0 + second, 'freq': 500, 'adc': 1, 'gain': 400,
            'left1': left, 'left2': left, 'right1': right, 'right2': right, 'seq': second,
        }
        for _ in range(2):
            yield {
                'type': 'capSense2', 'ts': t0 + second, 'version': 1,
                'left': {'values': cap_values(night, 'left', second, cap_index), 'status': 'good'},
                'right': {'values': cap_values(night, 'right', second, cap_index), 'status': 'good'},
            }
            cap_index += 1


def legacy_cap_counts(night: Night, side: str, second: int, counts_per_unit: float) -> Dict[str, int]:
    """One side's out, cen and in counts; counts_per_unit converts the night's capSense2 levels."""
    rise = cap_level(night, side, second) * counts_per_unit / 3
    return {name: int(round(mean + rise)) for name, mean in zip(('out', 'cen', 'in'), LEGACY_COUNTS[side])}


def legacy_raw_records(night: Night, counts_per_unit: float, t0: int = T0, start: int = 0,
                       end: Optional[int] = None, piezo_every: int = 1) -> Iterator[Dict]:
    """Records in the older layout: two piezo sensors a side and two capSense records a second."""
    end = night.seconds if end is None else end
    for second in range(start, end):
        if second % piezo_every == 0:
            left = piezo_samples(piezo_level(night, 'left', second))
            right = piezo_samples(piezo_level(night, 'right', second))
            yield {
                'type': 'piezo-dual', 'ts': t0 + second, 'freq': 500, 'adc': 1, 'gain': 400,
                'left1': left, 'left2': left, 'right1': right, 'right2': right, 'seq': 3 * second,
            }
        for offset in (1, 2):
            record = {'type': 'capSense', 'ts': t0 + second, 'seq': 3 * second + offset}
            for side in SIDES:
                record[side] = dict(legacy_cap_counts(night, side, second, counts_per_unit), status='good')
            yield record


def legacy_cap_payload(side: str, **extra) -> Dict:
    """A calibrated capacitance baseline in counts, as the calibrator stores it."""
    payload = {f'{side}_{name}': {'mean': float(mean), 'std': 1}
               for name, mean in zip(('out', 'cen', 'in'), LEGACY_COUNTS[side])}
    payload.update(extra)
    return payload


def write_raw_file(path: str, records) -> None:
    """Write records in the Pod's {seq, data} RAW framing."""
    with open(path, 'wb') as handle:
        for seq, record in enumerate(records):
            handle.write(cbor2.dumps({'seq': seq, 'data': cbor2.dumps(record)}))


# Right in first and out last, left in second and out first, with a 20 minute
# capacitance sag on the right that must not end that night.
STAGGERED = Night(
    seconds=16_200,
    left=((1800, 13_800),),
    right=((600, 15_000),),
    overrides=(('right', 5000, 6200, 3.3),),
)

# Left in bed: a 10 minute trip out (a real exit, merged into the night), a
# light cap-only tail after getting up, then a 15.5 minute absence (past the
# merge gap) before a short return. Right is a very light sleeper whose piezo
# barely clears the noise floor and sits on the bed for 20 s during the long
# absence, a visit too short to count as a night but long enough to register.
INTERIOR_EXIT = Night(
    seconds=13_900,
    left=((300, 6000), (6600, 12_000), (13_230, 13_800)),
    right=((12_500, 12_520),),
    piezo=(5_000_000.0, 155_000.0),
    overrides=(('left', 12_000, 12_300, 6.5),),
)
