"""Forward only fresh, explicit circulation telemetry to the local adaptive controller."""
import json
import math
import time
import urllib.request

_last_sent = 0.0


def circulation_sample(record, now):
    stamp = record.get('ts')
    if isinstance(stamp, bool) or not isinstance(stamp, (float, int)) or not math.isfinite(stamp):
        return None
    if stamp > now or now - stamp > 30:
        return None
    def healthy(side):
        pump = (record.get(side) or {}).get('pump') or {}
        rpm = pump.get('rpm')
        return (not isinstance(rpm, bool) and isinstance(rpm, (int, float))
                and math.isfinite(rpm) and rpm >= 1800 and pump.get('water') is True)
    return {'at': stamp * 1000, 'left': healthy('left'), 'right': healthy('right')}


def report_circulation(record):
    global _last_sent
    now = time.time()
    sample = circulation_sample(record, now)
    if sample is None or 0 <= now - _last_sent < 10:
        return
    request = urllib.request.Request('http://127.0.0.1:3000/api/adaptive-temperature/circulation',
                                     data=json.dumps(sample).encode(), headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=1) as response:
            if response.status == 204:
                _last_sent = now
    except Exception:
        # Missing heartbeat disables adaptation. Never take down biometrics.
        pass
