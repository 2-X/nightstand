"""Normalize hardware diagnostics with source timestamps; never forward waveforms."""
import json
import math
import time
import urllib.request

KINDS = ('frzTemp', 'frzHealth', 'frzTherm', 'bedTemp', 'sensHealth', 'blanketReadings', 'capSense')
_sent = {}


def normalize(row, now):
    if not isinstance(row, dict):
        return None
    kind, stamp = row.get('type'), row.get('ts')
    if kind not in KINDS or type(stamp) not in (int, float) or not math.isfinite(stamp) or not 0 <= now - stamp <= 90:
        return None
    fields = {}

    def mapping(value):
        return value if isinstance(value, dict) else {}

    def number(key, value, scale=1, minimum=-100000, maximum=100000):
        fields[key] = value / scale if type(value) in (int, float) and math.isfinite(value) and minimum <= value / scale <= maximum else None

    def temperature(key, value, scale=1):
        number(key, value, scale, -40, 125)

    def flag(key, value):
        fields[key] = value if isinstance(value, bool) else None

    if kind == 'frzTemp':
        for key in ('amb', 'hs', 'left', 'right'):
            temperature(key + 'C', row.get(key), 100)
    elif kind == 'bedTemp':
        for key in ('amb', 'mcu'):
            temperature(key + 'C', row.get(key), 100)
        number('humidityRaw', row.get('hu'))  # Scaling not independently verified.
        for side in ('left', 'right'):
            channel = row.get(side) if isinstance(row.get(side), dict) else {}
            for key in ('side', 'out', 'cen', 'in'):
                temperature(side + '.' + key + 'C', channel.get(key), 100)
    else:
        for side in ('left', 'right'):
            channel = row.get(side) if isinstance(row.get(side), dict) else {}
            if kind == 'frzHealth':
                pump, tec = mapping(channel.get('pump')), mapping(channel.get('tec'))
                number(side + '.pumpRpm', pump.get('rpm'), minimum=0)
                flag(side + '.waterDetected', pump.get('water'))
                number(side + '.reportedTecCurrent', tec.get('current'), minimum=0, maximum=100)
                temperature(side + '.loopC', mapping(channel.get('temps')).get('flowrate'))
            elif kind == 'frzTherm':
                if not isinstance(channel, dict):
                    channel = {}
                temperature(side + '.targetC', channel.get('target'))
                number(side + '.power', channel.get('power'), minimum=-1, maximum=1)
                for key in ('valid', 'enabled'):
                    flag(side + '.' + key, channel.get(key))
            elif kind == 'sensHealth':
                flag(side + '.connected', channel.get('connected'))
            elif kind == 'capSense':
                fields[side + '.statusGood'] = channel.get('status') == 'good' if isinstance(channel.get('status'), str) else None
            elif kind == 'blanketReadings':
                temperature(side + '.connectorC', channel.get('temp'))
                for key in ('x', 'y', 'z', 'flow_direction'):
                    number(side + '.' + key, channel.get(key))
                for key in ('is_connected', 'correct_orientation'):
                    flag(side + '.' + key, channel.get(key))
                fields[side + '.error'] = bool(channel['error_string']) if 'error_string' in channel else None
        if kind == 'frzHealth':
            for fan in ('top', 'bottom'):
                number(fan + '.fanRpm', mapping(mapping(row.get('fan')).get(fan)).get('rpm'), minimum=0)
    return {'kind': kind, 'at': stamp, 'fields': fields}


def report_sensor(row):
    sample = normalize(row, time.time())
    if sample is None or sample['at'] - _sent.get(sample['kind'], 0) < 10:
        return
    request = urllib.request.Request('http://127.0.0.1:3000/api/sensors', method='POST',
        headers={'Content-Type': 'application/json'}, data=json.dumps(sample, allow_nan=False).encode())
    try:
        with urllib.request.urlopen(request, timeout=1) as response:
            if response.status == 204:
                _sent[sample['kind']] = sample['at']
    except (OSError, ValueError):
        # A missed delivery remains visibly stale; never fabricate freshness.
        pass
