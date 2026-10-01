"""Capacitance record formats, read into the same three channels per side.

Every capacitance format the Pod firmware writes is read here and nowhere
else, so the detector, its thresholds and the analyzer never depend on a
record's shape.
"""
from __future__ import annotations

import math
import numbers
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

Channels = Tuple[Optional[float], Optional[float], Optional[float]]


@dataclass(frozen=True)
class CapFormat:
    """One capacitance record format.

    unit converts the detector's fixed capacitance levels, set on capSense2,
    into this format's raw units. validated is True only for a format whose
    nights have been checked against sleepers' own notes, and model.on_this_pod
    clears it on any Pod but a Pod 5.
    """
    name: str
    unit: float
    validated: bool


# Pod 5's newer cover: eight floats per side, about two records a second.
CAPSENSE2 = CapFormat(name='capSense2', unit=1.0, validated=True)
# Three integer counts per side. An occupied side is reported to rise by
# hundreds of counts against 10 to 20 on capSense2, so the starting entry
# level is 300 counts; each Pod then learns its own level.
CAPSENSE = CapFormat(name='capSense', unit=75.0, validated=False)
FORMATS: Dict[str, CapFormat] = {cap_format.name: cap_format for cap_format in (CAPSENSE2, CAPSENSE)}

# capSense2 writes -1.0 for a value it has no reading for, on all eight of a
# side or on only some of them.
SENTINEL = -1.0
# The eight values arrive as four near-identical pairs; the fourth pair is a
# reference near zero, so the first three pairs are the channels.
CHANNEL_PAIRS = ((0, 1), (2, 3), (4, 5))
LEGACY_CHANNELS = ('out', 'cen', 'in')
# A type starting with one of these is capacitance, read here or not.
CAP_TYPE_PREFIXES = ('capsense', 'cap_', 'cap-', 'capacit')
# The most of an unknown type's name that goes into a log line.
TYPE_NAME_LENGTH = 40


@dataclass(frozen=True)
class CapReading:
    ts: object
    cap_format: CapFormat
    left: Optional[Channels]
    right: Optional[Channels]


def read_cap(record) -> Optional[CapReading]:
    """Both sides' channels from one capacitance record; None for any other record.

    A side whose structure is not the format's, or that holds a number too
    large for a float, is None. Otherwise each channel without a reading is
    None.
    """
    if not isinstance(record, dict):
        return None
    cap_format = format_named(record.get('type'))
    if cap_format is None:
        return None
    reader = _capsense2_channels if cap_format is CAPSENSE2 else _capsense_channels
    return CapReading(record.get('ts'), cap_format, _read_side(reader, record.get('left')),
                      _read_side(reader, record.get('right')))


def unknown_cap_type(record) -> Optional[str]:
    """The type of a record that looks like capacitance but is no format read here."""
    kind = record.get('type') if isinstance(record, dict) else None
    if isinstance(kind, str) and kind.lower().startswith(CAP_TYPE_PREFIXES) and kind not in FORMATS:
        return kind
    return None


def printable_type(kind: str) -> str:
    """A record type as it may appear in a log line: printable characters only, cut short."""
    return ''.join(character for character in kind if character.isprintable())[:TYPE_NAME_LENGTH]


def format_named(name) -> Optional[CapFormat]:
    return FORMATS.get(name) if isinstance(name, str) else None


def majority_format(counts) -> Optional[CapFormat]:
    """The known format with the most records; a tie goes to the one listed first in FORMATS."""
    known = [(counts.get(name, 0), -order, name) for order, name in enumerate(FORMATS) if counts.get(name, 0)]
    return FORMATS[max(known)[2]] if known else None


def _read_side(reader, side) -> Optional[Channels]:
    try:
        return reader(side)
    except OverflowError:
        # An integer too large for a float, such as a CBOR bignum.
        return None


def _is_number(value) -> bool:
    return isinstance(value, numbers.Real) and not isinstance(value, bool)


def _capsense2_channels(side) -> Optional[Channels]:
    values = side.get('values') if isinstance(side, dict) else None
    if not isinstance(values, (list, tuple)) or len(values) < 6:
        return None
    if not all(value is None or _is_number(value) for value in values):
        return None
    channels = []
    for first, second in CHANNEL_PAIRS:
        readings = [value for value in (values[first], values[second])
                    if value is not None and value != SENTINEL and not math.isnan(value)]
        channels.append(sum(readings) / len(readings) if readings else None)
    return tuple(channels)


def _capsense_channels(side) -> Optional[Channels]:
    if not isinstance(side, dict):
        return None
    values = [side.get(name) for name in LEGACY_CHANNELS]
    if not all(value is None or _is_number(value) for value in values):
        return None
    if side.get('status', 'good') != 'good':
        return (None, None, None)
    return tuple(_count(value) for value in values)


def _count(value) -> Optional[float]:
    # A negative count is a firmware placeholder, never a reading.
    if value is None or not math.isfinite(value) or value < 0:
        return None
    return float(value)
