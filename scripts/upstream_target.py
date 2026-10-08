#!/usr/bin/env python3
"""Select the validated upstream target without a branch fallback."""
import argparse
import datetime
import json
from pathlib import Path
import re
import sys
import time


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


def validate_legacy(value):
    if not isinstance(value, dict):
        raise ValueError('No legacy upstream target')
    complete = dict(value, version='0.0.0', treeSha256=value.get('treeSha256', '0' * 64))
    validated = validate_target(complete)
    return {key: validated[key] for key in ('commit', 'date', 'treeSha256') if key in value}


def request_target(path):
    if not path.exists():
        return None
    request = json.loads(path.read_text())
    if not isinstance(request, dict):
        raise ValueError('Invalid switch request')
    if 'target' not in request:
        return None
    if request.get('source') != 'app' or time.time() - path.stat().st_mtime > 600:
        raise ValueError('Invalid or expired confirmed switch request')
    value = request['target']
    fields = {'commit', 'date', 'treeSha256', 'version'}
    if not isinstance(value, dict) or set(value) - fields:
        raise ValueError('Invalid confirmed switch target')
    return validate_target(value) if 'version' in value else validate_legacy(value)


def select_confirmed_switch(manifest, confirmed):
    if not isinstance(manifest, dict):
        raise ValueError('Invalid release manifest')
    if 'version' in confirmed:
        return select_target(manifest, confirmed)
    target = validate_legacy(manifest.get('upstreamSwitch'))
    if target != validate_legacy(confirmed):
        raise ValueError('Upstream target changed after confirmation')
    return target


def verify_artifact(target, commit, version, tree_sha256):
    target = validate_target(target)
    if (commit, version, tree_sha256) != (target['commit'], target['version'], target['treeSha256']):
        raise ValueError('Upstream artifact does not match the confirmed target')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path, nargs='?')
    parser.add_argument('--confirmed', type=Path)
    parser.add_argument('--request', type=Path)
    parser.add_argument('--confirmed-json')
    args = parser.parse_args()
    try:
        if args.request:
            target = request_target(args.request)
            print(json.dumps(target, sort_keys=True) if target is not None else '')
            return
        if args.manifest is None:
            raise ValueError('Missing release manifest')
        manifest = json.loads(sys.stdin.read() if str(args.manifest) == '-' else args.manifest.read_text())
        if args.confirmed_json is not None:
            target = select_confirmed_switch(manifest, json.loads(args.confirmed_json))
            print('v2' if 'version' in target else 'pin', target['commit'], target.get('treeSha256', ''))
            return
        confirmed = validate_target(json.loads(args.confirmed.read_text())) if args.confirmed else None
        print(json.dumps(select_target(manifest, confirmed), sort_keys=True))
    except (OSError, ValueError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
