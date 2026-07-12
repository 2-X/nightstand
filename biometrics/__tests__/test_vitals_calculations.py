"""Regression test: the kwargs _calculate() passes to the vendored heartpy
process() must all exist in its signature.

The vendored copy in heart/heartpy.py was slimmed upstream (Feb 2025) and no
longer accepts every parameter the original PyPI heartpy did. Passing a
removed kwarg raises TypeError on every call, which
estimate_heart_rate_intervals() swallows in its blanket except, the interval
vitals pipeline then "succeeds" with zero measurements and no error anywhere.

Run locally (needs numpy, scipy, pandas, pytest, not part of the node CI):
    python3 -m pytest biometrics/__tests__/test_vitals_calculations.py -v
"""
import inspect

import numpy as np
import pytest

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import logging
import get_logger as _gl

_gl._get_file_handler = lambda data_folder_path, name: logging.NullHandler()

from get_logger import get_logger
get_logger('sleep-analyzer')

from heart.exceptions import BadSignalWarning
from heart.heartpy import process


# Mirror of the keyword arguments _calculate() in vitals/calculations.py
# passes to process(). If you change that call, update this set, the test
# exists to catch the call site drifting from the vendored signature.
CALCULATE_PROCESS_KWARGS = {
    'breathing_method': 'fft',
    'bpmmin': 40,
    'bpmmax': 90,
    'windowsize': 0.75,
    'calculate_breathing': True,
}


def test_calculate_kwargs_bind_to_vendored_process():
    """signature.bind raises TypeError on unexpected kwargs without running."""
    sig = inspect.signature(process)
    sig.bind(np.zeros(10), 500, **CALCULATE_PROCESS_KWARGS)


def test_process_runs_with_calculate_kwargs():
    """End-to-end: process() executes with the _calculate() kwargs.

    A TypeError from an unexpected kwarg fires before any body code runs, so
    reaching either a measurement or a BadSignalWarning (the vendored peak
    detector is picky about synthetic signals) proves the call is valid.
    """
    sample_rate = 500
    seconds = 30
    bpm = 60.0
    t = np.arange(seconds * sample_rate) / sample_rate
    beat_period = 60.0 / bpm
    phase = np.mod(t, beat_period)
    signal = np.exp(-0.5 * ((phase - 0.15) / 0.04) ** 2) + 1.0
    try:
        working_data, measurement = process(
            signal,
            sample_rate,
            **CALCULATE_PROCESS_KWARGS,
        )
    except BadSignalWarning:
        return  # signal-quality rejection, not a call-signature failure
    assert 40 <= measurement['bpm'] <= 90


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
