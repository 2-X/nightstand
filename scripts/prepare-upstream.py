#!/usr/bin/env python3
"""Convert only incompatible Nightstand values after a recoverable backup."""
import json
import os
from pathlib import Path
import sys
import tempfile

DAYS = ('sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday')


def prepare(folder):
    folder = Path(folder)
    paths = [folder / 'settingsDB.json', folder / 'schedulesDB.json']
    settings, schedules = [json.loads(path.read_text()) for path in paths]
    if settings.get('temperatureFormat') == 'level':
        settings['temperatureFormat'] = 'fahrenheit'
    for side in ('left', 'right'):
        taps = settings.get(side, {}).get('taps', {})
        for gesture in ('doubleTap', 'tripleTap', 'quadTap'):
            if taps.get(gesture, {}).get('type') == 'base_control':
                taps[gesture] = dict(type='alarm', behavior='dismiss',
                                     snoozeDuration=300, inactiveAlarmBehavior='none')
        for day in DAYS:
            entry = schedules.get(side, {}).get(day)
            if not isinstance(entry, dict):
                continue
            alarms = entry.pop('alarms', None)
            if isinstance(alarms, list):
                enabled = next((alarm for alarm in alarms if alarm.get('enabled') is True), None)
                selected = enabled or (alarms[0] if alarms else entry.get('alarm', {}))
                entry['alarm'] = dict(selected, enabled=enabled is not None)
            alarm = entry.get('alarm')
            if isinstance(alarm, dict) and isinstance(alarm.get('duration'), (int, float)):
                alarm['duration'] = min(alarm['duration'], 180)
    # Parse and transform both documents before publishing either one. The caller
    # stops writers and restores its backup if any publication fails.
    for path, value in zip(paths, (settings, schedules)):
        original = path.stat()
        descriptor, temporary = tempfile.mkstemp(prefix=path.name + '.', dir=folder)
        try:
            with os.fdopen(descriptor, 'w') as output:
                json.dump(value, output, indent=2)
                output.write('\n')
                output.flush()
                os.fsync(output.fileno())
            os.chmod(temporary, original.st_mode & 0o777)
            if os.geteuid() == 0:
                os.chown(temporary, original.st_uid, original.st_gid)
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)


if __name__ == '__main__':
    try:
        prepare(sys.argv[1])
    except (OSError, ValueError, TypeError, AttributeError, IndexError) as error:
        sys.exit('Could not prepare upstream settings: ' + str(error))
