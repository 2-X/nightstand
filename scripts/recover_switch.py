#!/usr/bin/env python3
"""Offline switch recovery. The shell entry point serializes live restoration.

metadata.recovery records paths (kind, live, saved, failed, device, inode),
with realParents for each mapped path,
services (active and enabled booleans, optional enabledMode), and optionally the operation unit and
its systemd invocationId. Capture identities before arming, and run operations
in a dedicated systemd control group. Directory environments stay at their
original path on restore; prepared environments are never relocated.
Before controlled target starts, enter validating and record a validation-startup
intent listing the server and stream units. Their startup checks also require
the recorded operation invocation to be active and the maintenance lock held.
"""
import argparse
import fcntl
import os
from pathlib import Path
import re
import subprocess
import time

from switch_transaction import TransactionStore, absolute_path, fsync_directory
from switch_services import Configuration, restore as restore_configuration, restore_enablement

WRITERS = ('free-sleep.service', 'free-sleep-stream.service',
           'free-sleep-archive-raw.service', 'free-sleep-health.service',
           'free-sleep-network-watchdog.service', 'free-sleep-recover-update.service')
OPERATIONS = ('free-sleep-update.service', 'free-sleep-rollback.service', 'free-sleep-revert.service')
SERVICES = WRITERS + ('free-sleep-archive-raw.timer', 'free-sleep-health.timer',
                     'free-sleep-network-watchdog.timer')
TERMINAL = ('committed', 'cleaned', 'recovered')


def controller(*arguments):
    return subprocess.run(['systemctl'] + list(arguments), check=True,
                          capture_output=True, text=True, timeout=20).stdout.strip()


def journals(store):
    if not store.root.exists() and not store.root.is_symlink():
        return []
    if store.root.is_symlink() or not store.root.is_dir():
        raise ValueError('Invalid transaction root')
    result = []
    for entry in sorted(store.root.iterdir()):
        if entry.is_symlink() or not entry.is_dir():
            raise ValueError('Unexpected transaction entry')
        result.append(store.load(entry.name))
    if sum(journal['phase'] not in TERMINAL for journal in result) > 1:
        raise ValueError('Multiple unfinished switches require manual recovery')
    return result


def recovery_record(journal):
    record = journal['metadata'].get('recovery')
    if not isinstance(record, dict) or not isinstance(record.get('paths'), list) or not record['paths']:
        raise ValueError('Missing switch recovery paths')
    seen = set()
    trees = 0
    for mapping in record['paths']:
        if not isinstance(mapping, dict) or mapping.get('kind') not in ('tree', 'environment'):
            raise ValueError('Invalid recovery mapping')
        for key in ('live', 'saved', 'failed'):
            path = absolute_path(mapping.get(key))
            if str(path) in seen:
                raise ValueError('Overlapping recovery paths')
            seen.add(str(path))
            parents = mapping.get('realParents')
            if (not isinstance(parents, dict) or not path.parent.is_dir()
                    or str(path.parent.resolve()) != str(absolute_path(parents.get(key)))):
                raise ValueError('Recovery mapping parent changed')
        for key in ('device', 'inode'):
            if type(mapping.get(key)) is not int or mapping[key] < 0:
                raise ValueError('Missing source filesystem identity')
        if mapping['kind'] == 'tree':
            trees += 1
            if mapping['live'] != journal['source']['treePath']:
                raise ValueError('Source tree does not match recovery mapping')
    if trees != 1:
        raise ValueError('Recovery requires one source tree')
    paths = [Path(path) for path in seen]
    if any(first in second.parents for first in paths for second in paths if first != second):
        raise ValueError('Nested recovery paths')
    services = record.get('services')
    if not isinstance(services, dict) or not {'free-sleep.service', 'free-sleep-stream.service'} <= services.keys():
        raise ValueError('Missing writer service state')
    for unit, state in services.items():
        if unit not in SERVICES or not isinstance(state, dict) or any(type(state.get(key)) is not bool for key in ('active', 'enabled')):
            raise ValueError('Invalid recorded service state')
    operation = record.get('operation')
    if operation is not None:
        if (not isinstance(operation, dict) or operation.get('unit') not in OPERATIONS
                or not isinstance(operation.get('invocationId'), str)
                or re.fullmatch(r'[0-9a-f]{32}', operation['invocationId']) is None):
            raise ValueError('Invalid operation invocation identity')
    return record


def check_startup(store, unit, lock_path):
    """Permit pending switches only for explicitly requested target validation."""
    if unit not in WRITERS + OPERATIONS:
        raise ValueError('Unknown startup unit')
    pending = [journal for journal in journals(store) if journal['phase'] not in TERMINAL]
    if not pending:
        return
    journal = pending[0]
    record = recovery_record(journal)
    permissions = [item['details'] for item in journal['intents'] if item['name'] == 'validation-startup']
    if (journal['phase'] != 'validating' or len(permissions) != 1
            or unit not in ('free-sleep.service', 'free-sleep-stream.service')
            or not isinstance(permissions[0].get('units'), list) or unit not in permissions[0]['units']):
        raise ValueError('An unfinished switch blocks writer startup')
    operation = record.get('operation')
    if (operation is None
            or controller('show', '--property=InvocationID', '--value', operation['unit']) != operation['invocationId']
            or controller('show', '--property=ActiveState', '--value', operation['unit']) not in ('active', 'activating')):
        raise ValueError('Validation operation is no longer running')
    with Path(lock_path).open('r') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        fcntl.flock(lock, fcntl.LOCK_UN)
    raise ValueError('Validation operation no longer holds the maintenance lock')


def matching(path, mapping):
    try:
        status = path.lstat()
    except FileNotFoundError:
        return False
    return (status.st_dev, status.st_ino) == (mapping['device'], mapping['inode'])


def restore_paths(journal, record):
    # Check every source before moving any path. Never overwrite retained evidence.
    for mapping in record['paths']:
        live, saved, failed = (Path(mapping[key]) for key in ('live', 'saved', 'failed'))
        source = live if matching(live, mapping) else saved
        if not matching(source, mapping):
            raise ValueError('Original installation is missing: ' + str(live))
        if source != live and os.path.lexists(str(live)) and os.path.lexists(str(failed)):
            raise ValueError('Failed installation path is already occupied: ' + str(failed))
        if mapping['kind'] == 'tree':
            import json
            if source.is_symlink() or not source.is_dir():
                raise ValueError('Original tree is not a directory')
            if json.loads((source / 'server/src/serverInfo.json').read_text())['version'] != journal['source']['version']:
                raise ValueError('Original tree version mismatch')
    for mapping in record['paths']:
        live, saved, failed = (Path(mapping[key]) for key in ('live', 'saved', 'failed'))
        if matching(live, mapping):
            continue
        if os.path.lexists(str(live)):
            os.rename(str(live), str(failed))
            fsync_directory(live.parent)
            fsync_directory(failed.parent)
        os.rename(str(saved), str(live))
        fsync_directory(saved.parent)
        fsync_directory(live.parent)


def stop_operations(store):
    for journal in journals(store):
        if journal['phase'] in TERMINAL:
            continue
        record = recovery_record(journal)
        operation = record.get('operation')
        if operation:
            invocation = controller('show', '--property=InvocationID', '--value', operation['unit'])
            if invocation == operation['invocationId']:
                controller('kill', '--kill-who=all', '--signal=SIGKILL', operation['unit'])
                group = controller('show', '--property=ControlGroup', '--value', operation['unit'])
                if group:
                    if not group.startswith('/') or '..' in Path(group).parts:
                        raise ValueError('Invalid operation control group')
                    roots = [Path('/sys/fs/cgroup' + group), Path('/sys/fs/cgroup/systemd' + group)]
                    root = next((path for path in roots if path.is_dir()), None)
                    if root is None:
                        continue
                    for attempt in range(20):
                        members = list(root.rglob('cgroup.procs'))
                        if members and all(not path.read_text().strip() for path in members):
                            break
                        if not root.exists():
                            break
                        time.sleep(0.1)
                    else:
                        raise ValueError('Operation descendants did not stop')


def restore(store, helper):
    pending = [journal for journal in journals(store) if journal['phase'] not in TERMINAL]
    for journal in pending:
        record = recovery_record(journal)
        units = list(WRITERS) + [unit for unit in record['services'] if unit not in WRITERS]
        subprocess.run(['bash', '-c', 'source "$1"; shift; for unit in "$@"; do '
                        'restore_stop_writer "$unit" || exit 1; done',
                        'stop-writers', str(helper)] + units, check=True, timeout=40)
        if journal['phase'] != 'recovering':
            store.intent(journal['id'], 'recovery-start', dict(phase=journal['phase']))
        store.advance(journal['id'], 'recovering')
        restore_paths(journal, record)
        tree = next(mapping for mapping in record['paths'] if mapping['kind'] == 'tree')
        subprocess.run(['bash', '-c', 'set -e; source "$1"; LIVE="$2"; restore_dependencies "$3"',
                        'restore-dependencies', str(helper), tree['live'], tree['failed']], check=True, timeout=40)
        live = Path(tree['live'])
        if (live / 'server/package-lock.json').is_file() and not (live / 'server/node_modules').is_dir():
            raise ValueError('Restored installation has no matching Node dependencies')
        configurations = [item['details'] for item in journal['intents'] if item['name'] == 'system-configuration']
        restored_states = {}
        if configurations:
            if len(configurations) != 1 or configurations[0]['live'] != str(live):
                raise ValueError('Invalid recovery system configuration')
            config = Configuration(absolute_path(configurations[0]['root']), live)
            restored_states = restore_configuration(store, journal['id'], config, release_services=False)
        elif not (journal['phase'] in ('armed', 'writers-stopped') or any(
                item['name'] == 'recovery-start' and item['details'].get('phase') in ('armed', 'writers-stopped')
                for item in journal['intents'])):
            raise ValueError('Missing saved system configuration for switch recovery')
        else:
            store.restore_snapshots(journal['id'])
        controller('daemon-reload')
        for unit, state in record['services'].items():
            restored_states.setdefault(unit, {}).update(state)
        starts = []
        for unit, state in restored_states.items():
            if state.get('present') is False:
                continue
            restore_enablement(unit, state, runner=lambda command: controller(*command[1:]))
            if state['active'] and unit not in OPERATIONS + ('free-sleep-recover-switch.service',):
                starts.append(unit)
        store.advance(journal['id'], 'recovered')
        for unit in starts:
            controller('start', '--no-block', unit)
        # Nonblocking starts wait for this oneshot to exit. Stopping writers
        # may have cancelled their initial boot jobs, so explicitly queue them.
        print('Restored the source installation offline: ' + journal['id'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('command', choices=('check', 'startup-check', 'stop-operations', 'restore', 'pending'))
    parser.add_argument('--helper', type=Path)
    parser.add_argument('--unit')
    parser.add_argument('--operation-lock', type=Path)
    args = parser.parse_args()
    try:
        store = TransactionStore(args.root)
        if args.command == 'startup-check':
            check_startup(store, args.unit, args.operation_lock)
        elif args.command in ('check', 'pending'):
            pending = [journal for journal in journals(store) if journal['phase'] not in TERMINAL]
            if args.command == 'pending':
                for journal in pending:
                    print(journal['id'])
            elif pending:
                raise ValueError('An unfinished switch blocks writer startup')
        elif args.command == 'stop-operations':
            stop_operations(store)
        else:
            if args.helper is None:
                raise ValueError('Missing restore helper')
            restore(store, args.helper)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        parser.exit(1, 'Switch recovery stopped: ' + str(error) + '\n')


if __name__ == '__main__':
    main()
