#!/usr/bin/env python3
"""Preserve configured archive retention in an older extracted release."""
import pathlib
import re
import sys


def prepare(script_path, config_path):
    script = pathlib.Path(script_path)
    source = script.read_text()
    config = pathlib.Path(config_path)
    hours = 336
    if config.exists():
        match = re.search(r"^RETENTION_HOURS=(\d{1,5})$", config.read_text(), re.M)
        if match and 24 <= int(match[1]) <= 1440:
            hours = int(match[1])
    # Config-aware releases already implement the same contract.
    if re.search(r'^CONF=.*raw-archive\.conf', source, re.M) and 'conf_hours' in source:
        return
    updated, count = re.subn(r'^RETENTION_HOURS=\d+\s*$',
                             'RETENTION_HOURS=' + str(hours), source, flags=re.M)
    if count != 1:
        raise ValueError('cannot identify archive retention; refusing to change the target')
    script.write_text(updated)
    print('Preserved archive retention: {} hours'.format(hours))


if __name__ == '__main__':
    try:
        prepare(*sys.argv[1:])
    except (OSError, ValueError, TypeError) as error:
        sys.exit('Archive retention could not be preserved: ' + str(error))
