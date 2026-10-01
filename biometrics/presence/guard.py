"""Notice when capacitance cannot explain the bed being in use.

On a capacitance format not yet checked against sleepers' notes, levels
that do not fit the Pod show up as a bed whose piezo reads someone alive
while capacitance places nobody in it. Ten such minutes in fifteen hand
live presence back to piezo, long before presence auto-off could act.
"""
from __future__ import annotations

from collections import deque
from typing import Dict, Optional

from .detector import PIEZO_ALIVE_MARGIN, SIDES, DetectorParams

UNEXPLAINED_WINDOW_SECONDS = 900
UNEXPLAINED_SECONDS = 600


class UnexplainedUseGuard:
    def __init__(self, params: DetectorParams):
        self._gates = {side: params.piezo_floor[side] * PIEZO_ALIVE_MARGIN for side in SIDES}
        self._recent: deque = deque(maxlen=UNEXPLAINED_WINDOW_SECONDS)
        self._count = 0

    def step(self, states: Dict[str, bool], piezo: Dict[str, Optional[float]]) -> bool:
        """Record one second; True once capacitance has missed the bed's use for too long."""
        in_use = any(_at_least(piezo.get(side), self._gates[side]) for side in SIDES)
        unexplained = in_use and not any(states.values())
        if len(self._recent) == self._recent.maxlen:
            self._count -= self._recent[0]
        self._recent.append(unexplained)
        self._count += unexplained
        return self._count >= UNEXPLAINED_SECONDS


def _at_least(value: Optional[float], gate: float) -> bool:
    return value is not None and value == value and value >= gate
