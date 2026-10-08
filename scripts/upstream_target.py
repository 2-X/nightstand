#!/usr/bin/env python3
"""Select the validated upstream target without a branch fallback."""
import argparse
import datetime
import json
from pathlib import Path
import re


def validate_target(value):
    patterns = {'commit': r'[0-9a-f]{40}', 'version': r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)',
                'treeSha256': r'[0-9a-f]{64}', 'date': r'[0-9]{4}-[0-9]{2}-[0-9]{2}'}
    if not isinstance(value, dict):
        raise ValueError('No validated upstream target')
    for field, pattern in patterns.items():
        if not isinstance(value.get(field), str) or re.fullmatch(pattern, value[field]) is None:
            raise ValueError('Invalid upstream target ' + field)
    datetime.date.fromisoformat(value['date'])
    return {field: value[field] for field in patterns}


def select_target(manifest, confirmed=None):
    if not isinstance(manifest, dict):
        raise ValueError('Invalid release manifest')
    target = validate_target(manifest.get('upstreamSwitchV2'))
    if confirmed is not None and target != validate_target(confirmed):
        raise ValueError('Upstream target changed after confirmation')
    return target


def verify_artifact(target, commit, version, tree_sha256):
    target = validate_target(target)
    if (commit, version, tree_sha256) != (target['commit'], target['version'], target['treeSha256']):
        raise ValueError('Upstream artifact does not match the confirmed target')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--confirmed', type=Path)
    args = parser.parse_args()
    try:
        confirmed = validate_target(json.loads(args.confirmed.read_text())) if args.confirmed else None
        print(json.dumps(select_target(json.loads(args.manifest.read_text()), confirmed), sort_keys=True))
    except (OSError, ValueError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
