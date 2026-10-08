import copy
import errno
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import switch_transaction as storage
import recover_switch

ROOT = Path(__file__).resolve().parents[2]
SOURCE = {'fork': 'nightstand', 'commit': 'a' * 40, 'version': '3.6.1',
          'treeSha256': 'b' * 64, 'treePath': '/home/dac/free-sleep'}
TARGET = {**SOURCE, 'fork': 'upstream', 'commit': 'c' * 40, 'version': '3.0.3'}


class TransactionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.store = storage.TransactionStore(self.base / 'transactions')
        self.store.create('roundtrip', SOURCE, TARGET, {'stream': {'active': True, 'enabled': False}})
        self.file = self.base / 'settings.json'
        self.file.write_bytes(b'original\n')
        self.file.chmod(0o640)
        os.utime(self.file, ns=(123456789000, 987654321000))

    def test_snapshots_restore_exact_bytes_metadata_symlinks_and_absence_repeatedly(self):
        original = self.file.stat()
        missing = self.base / 'absent.json'
        link = self.base / 'venv'
        link.symlink_to('original-env')
        self.store.advance('roundtrip', 'writers-stopped')
        for name, path in [('settings', self.file), ('baseline', missing), ('environment', link)]:
            self.store.snapshot('roundtrip', name, path)
        journal = self.store.load('roundtrip')
        self.assertEqual(journal['snapshots']['baseline']['kind'], 'absent')
        self.assertEqual(journal['metadata']['stream'], {'active': True, 'enabled': False})
        self.store.advance('roundtrip', 'snapshots-ready')
        self.store.intent('roundtrip', 'publish-environment', {'path': str(link)})
        self.store.advance('roundtrip', 'installing')
        self.store.advance('roundtrip', 'recovering')
        for _ in range(2):
            self.file.write_bytes(b'changed')
            missing.write_bytes(b'new')
            link.unlink()
            link.symlink_to('upstream-env')
            self.store.restore_snapshots('roundtrip')
            restored = self.file.stat()
            self.assertEqual(self.file.read_bytes(), b'original\n')
            self.assertEqual((restored.st_mode, restored.st_uid, restored.st_gid, restored.st_mtime_ns),
                             (original.st_mode, original.st_uid, original.st_gid, original.st_mtime_ns))
            self.assertFalse(missing.exists())
            self.assertEqual(os.readlink(link), 'original-env')
        self.store.advance('roundtrip', 'recovered')
        self.assertEqual(self.store.load('roundtrip')['phase'], 'recovered')

    def test_commit_is_an_irreversible_boundary(self):
        for phase in ['writers-stopped', 'snapshots-ready', 'installing', 'validating', 'committed']:
            self.store.advance('roundtrip', phase)
        with self.assertRaises(ValueError):
            self.store.advance('roundtrip', 'recovering')
        with self.assertRaises(ValueError):
            self.store.restore_snapshots('roundtrip')
        self.store.advance('roundtrip', 'cleaned')
        self.assertEqual(self.store.load('roundtrip')['phase'], 'cleaned')

    def test_changed_parent_symlink_refuses_file_restoration_before_any_live_write(self):
        source = self.base / 'source'
        target = self.base / 'target'
        source.mkdir()
        target.mkdir()
        live = self.base / 'live'
        live.symlink_to(source, target_is_directory=True)
        (source / 'config').mkdir()
        (target / 'config').mkdir()
        (source / 'config/settings.json').write_bytes(b'source settings')
        (target / 'config/settings.json').write_bytes(b'target settings')
        self.store.advance('roundtrip', 'writers-stopped')
        self.store.snapshot('roundtrip', 'settings', self.file)
        self.store.snapshot('roundtrip', 'z-linked-settings', live / 'config/settings.json')
        self.store.advance('roundtrip', 'recovering')
        journal_path = self.store.root / 'roundtrip/journal.json'
        journal_bytes = journal_path.read_bytes()
        self.file.write_bytes(b'current settings')
        live.unlink()
        live.symlink_to(target, target_is_directory=True)

        with self.assertRaisesRegex(ValueError, 'Snapshot parent changed'):
            self.store.restore_snapshots('roundtrip')

        self.assertEqual(self.file.read_bytes(), b'current settings')
        self.assertEqual((source / 'config/settings.json').read_bytes(), b'source settings')
        self.assertEqual((target / 'config/settings.json').read_bytes(), b'target settings')
        self.assertEqual(journal_path.read_bytes(), journal_bytes)

    def test_changed_parent_symlink_refuses_absence_restoration_before_any_live_write(self):
        source = self.base / 'source'
        target = self.base / 'target'
        source.mkdir()
        target.mkdir()
        live = self.base / 'live'
        live.symlink_to(source, target_is_directory=True)
        (target / 'baseline.json').write_bytes(b'target baseline')
        self.store.advance('roundtrip', 'writers-stopped')
        self.store.snapshot('roundtrip', 'settings', self.file)
        self.store.snapshot('roundtrip', 'z-baseline', live / 'baseline.json')
        self.store.advance('roundtrip', 'recovering')
        journal_path = self.store.root / 'roundtrip/journal.json'
        journal_bytes = journal_path.read_bytes()
        self.file.write_bytes(b'current settings')
        live.unlink()
        live.symlink_to(target, target_is_directory=True)

        with self.assertRaisesRegex(ValueError, 'Snapshot parent changed'):
            self.store.restore_snapshots('roundtrip')

        self.assertEqual(self.file.read_bytes(), b'current settings')
        self.assertFalse((source / 'baseline.json').exists())
        self.assertEqual((target / 'baseline.json').read_bytes(), b'target baseline')
        self.assertEqual(journal_path.read_bytes(), journal_bytes)

    def test_unchanged_parent_symlink_restores_files_symlinks_and_absence(self):
        source = self.base / 'source'
        source.mkdir()
        live = self.base / 'live'
        live.symlink_to(source, target_is_directory=True)
        settings = live / 'settings.json'
        missing = live / 'baseline.json'
        link = live / 'environment'
        settings.write_bytes(b'source settings')
        link.symlink_to('source-env')
        self.store.advance('roundtrip', 'writers-stopped')
        for name, path in [('settings', settings), ('baseline', missing), ('environment', link)]:
            self.store.snapshot('roundtrip', name, path)
        self.store.advance('roundtrip', 'recovering')

        for _ in range(2):
            settings.write_bytes(b'changed settings')
            missing.write_bytes(b'new baseline')
            link.unlink()
            link.symlink_to('target-env')
            self.store.restore_snapshots('roundtrip')
            self.assertEqual((source / 'settings.json').read_bytes(), b'source settings')
            self.assertFalse((source / 'baseline.json').exists())
            self.assertEqual(os.readlink(source / 'environment'), 'source-env')
            self.assertEqual(live.resolve(), source.resolve())

    def test_absence_restore_does_not_require_or_create_a_missing_parent(self):
        missing = self.base / 'missing-parent' / 'baseline.json'
        self.store.advance('roundtrip', 'writers-stopped')
        self.store.snapshot('roundtrip', 'baseline', missing)
        self.store.advance('roundtrip', 'recovering')
        self.store.restore_snapshots('roundtrip')
        self.store.restore_snapshots('roundtrip')
        self.assertFalse(missing.parent.exists())
        missing.parent.mkdir()
        missing.symlink_to('absent-target')
        self.store.restore_snapshots('roundtrip')
        self.assertFalse(missing.is_symlink())

    def test_new_symlink_in_missing_parent_refuses_absence_restoration(self):
        missing = self.base / 'missing-parent' / 'baseline.json'
        target = self.base / 'target'
        target.mkdir()
        baseline = target / 'baseline.json'
        baseline.write_bytes(b'target baseline')
        self.store.advance('roundtrip', 'writers-stopped')
        self.store.snapshot('roundtrip', 'baseline', missing)
        self.store.advance('roundtrip', 'recovering')
        missing.parent.symlink_to(target, target_is_directory=True)

        with self.assertRaisesRegex(ValueError, 'Snapshot parent changed'):
            self.store.restore_snapshots('roundtrip')

        self.assertEqual(baseline.read_bytes(), b'target baseline')
        self.assertEqual(self.store.load('roundtrip')['phase'], 'recovering')

    def test_snapshot_without_real_parent_refuses_restoration_and_keeps_journal(self):
        self.store.advance('roundtrip', 'writers-stopped')
        self.store.snapshot('roundtrip', 'settings', self.file)
        self.store.advance('roundtrip', 'recovering')
        journal = self.store.load('roundtrip')
        del journal['snapshots']['settings']['realParent']
        journal_path = self.store.root / 'roundtrip/journal.json'
        envelope = {'journal': journal, 'sha256': storage.digest(storage.canonical(journal))}
        journal_bytes = storage.canonical(envelope)
        journal_path.write_bytes(journal_bytes)
        self.file.write_bytes(b'current settings')

        with self.assertRaisesRegex(ValueError, 'Unreadable transaction journal'):
            self.store.restore_snapshots('roundtrip')

        self.assertEqual(self.file.read_bytes(), b'current settings')
        self.assertEqual(journal_path.read_bytes(), journal_bytes)

    def test_restore_preflights_directory_conflicts_before_any_live_write(self):
        missing = self.base / 'baseline.json'
        self.store.advance('roundtrip', 'writers-stopped')
        self.store.snapshot('roundtrip', 'settings', self.file)
        self.store.snapshot('roundtrip', 'z-baseline', missing)
        self.store.advance('roundtrip', 'recovering')
        self.file.write_bytes(b'upstream')
        missing.mkdir()
        with self.assertRaises(ValueError):
            self.store.restore_snapshots('roundtrip')
        self.assertEqual(self.file.read_bytes(), b'upstream')
        self.assertTrue(missing.is_dir())

    def test_invalid_or_corrupt_journals_fail_closed_without_touching_source(self):
        path = self.base / 'transactions/roundtrip/journal.json'
        original = path.read_bytes()
        envelope = json.loads(original)
        changed = copy.deepcopy(envelope)
        changed['journal']['phase'] = 'committed'
        for value in [b'{', b'{}', json.dumps(changed).encode(),
                      json.dumps({**envelope, 'sha256': '0' * 64}).encode()]:
            with self.subTest(value=value):
                path.write_bytes(value)
                with self.assertRaises(ValueError):
                    self.store.load('roundtrip')
                with self.assertRaises(ValueError):
                    self.store.protected_backups()
                self.assertEqual(self.file.read_bytes(), b'original\n')
        path.write_bytes(original)
        with self.assertRaises(ValueError):
            self.store.create('../escape', SOURCE, TARGET)
        with self.assertRaises((ValueError, FileExistsError)):
            self.store.create('roundtrip', SOURCE, TARGET)

    def test_damaged_snapshot_refuses_all_restoration(self):
        self.store.advance('roundtrip', 'writers-stopped')
        second = self.base / 'second.json'
        second.write_bytes(b'second original')
        self.store.snapshot('roundtrip', 'settings', self.file)
        self.store.snapshot('roundtrip', 'second', second)
        snapshot = self.store.load('roundtrip')['snapshots']['second']
        (self.base / 'transactions/roundtrip' / snapshot['backup']).write_bytes(b'corrupt')
        self.file.write_bytes(b'upstream')
        self.store.advance('roundtrip', 'recovering')
        with self.assertRaises(ValueError):
            self.store.restore_snapshots('roundtrip')
        self.assertEqual(self.file.read_bytes(), b'upstream')

    def test_snapshot_enospc_never_records_an_incomplete_backup(self):
        self.store.advance('roundtrip', 'writers-stopped')
        with patch.object(storage.os, 'fsync', side_effect=OSError(errno.ENOSPC, 'full disk')):
            with self.assertRaises(OSError):
                self.store.snapshot('roundtrip', 'settings', self.file)
        self.assertEqual(self.store.load('roundtrip')['snapshots'], {})
        self.assertEqual(self.file.read_bytes(), b'original\n')

    def test_partial_write_enospc_keeps_journal_and_source(self):
        self.store.advance('roundtrip', 'writers-stopped')
        original = self.store.load('roundtrip')
        real_fdopen = os.fdopen

        class FullDisk:
            def __init__(self, descriptor, mode):
                self.output = real_fdopen(descriptor, mode)

            def __enter__(self):
                return self

            def __exit__(self, *args):
                self.output.close()

            def write(self, data):
                self.output.write(data[:len(data) // 2])
                self.output.flush()
                raise OSError(errno.ENOSPC, 'full disk')

        for action in [lambda: self.store.advance('roundtrip', 'snapshots-ready'),
                       lambda: self.store.snapshot('roundtrip', 'settings', self.file)]:
            with patch.object(storage.os, 'fdopen', FullDisk), self.assertRaises(OSError):
                action()
            self.assertEqual(self.store.load('roundtrip'), original)
            self.assertEqual(self.file.read_bytes(), b'original\n')
            self.assertFalse(list((self.store.root / 'roundtrip').glob('.pending-*')))

    def test_partial_arming_allows_startup_and_pruning_and_preserves_source(self):
        with patch.object(storage.os, 'fsync', side_effect=OSError(errno.ENOSPC, 'full disk')):
            with self.assertRaises(OSError):
                self.store.create('interrupted', SOURCE, TARGET)
        self.store.advance('roundtrip', 'recovering')
        self.store.advance('roundtrip', 'recovered')
        self.assertEqual(self.store.protected_backups(), set())
        recover_switch.check_startup(self.store, 'free-sleep.service', self.base / 'no-lock')
        self.assertEqual(self.file.read_bytes(), b'original\n')

    def test_restore_can_repeat_after_each_failed_file_publication(self):
        self.store.advance('roundtrip', 'writers-stopped')
        self.store.snapshot('roundtrip', 'settings', self.file)
        self.store.advance('roundtrip', 'recovering')
        for method in ['fsync', 'replace']:
            real = getattr(os, method)
            for boundary in range(1, 4 if method == 'fsync' else 2):
                for after in [False, True]:
                    with self.subTest(method=method, boundary=boundary, after=after):
                        self.file.write_bytes(b'upstream')
                        count = 0

                        def fail(*args, **kwargs):
                            nonlocal count
                            count += 1
                            if count == boundary and not after:
                                raise OSError(errno.ENOSPC, 'full disk')
                            result = real(*args, **kwargs)
                            if count == boundary and after:
                                raise OSError(errno.ENOSPC, 'full disk')
                            return result

                        with patch.object(storage.os, method, fail), self.assertRaises(OSError):
                            self.store.restore_snapshots('roundtrip')
                        self.assertEqual(self.store.load('roundtrip')['phase'], 'recovering')
                        self.store.restore_snapshots('roundtrip')
                        self.assertEqual(self.file.read_bytes(), b'original\n')

    def test_journal_semantics_reject_unknown_versions_and_missing_state(self):
        path = self.store.root / 'roundtrip/journal.json'
        original = path.read_bytes()
        journal = self.store.load('roundtrip')
        for field, value in [('schemaVersion', 2), ('schemaVersion', True), ('phase', 'unknown'), ('snapshots', []), ('source', {})]:
            changed = {**journal, field: value}
            path.write_bytes(storage.canonical({'journal': changed, 'sha256': storage.digest(storage.canonical(changed))}))
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.store.load('roundtrip')
        path.write_bytes(original)

    def test_create_rejects_invalid_metadata_before_creating_a_directory(self):
        for metadata in [[], False, 0, '']:
            with self.subTest(metadata=metadata), self.assertRaises(ValueError):
                self.store.create('invalid-metadata', SOURCE, TARGET, metadata)
            self.assertFalse((self.store.root / 'invalid-metadata').exists())

    def test_committed_backup_references_remain_protected(self):
        backup = self.base / 'retained.db'
        self.store.add_backup('roundtrip', backup)
        for phase in ['writers-stopped', 'snapshots-ready', 'installing', 'validating', 'committed', 'cleaned']:
            self.store.advance('roundtrip', phase)
        self.assertEqual(self.store.protected_backups(), {str(backup.resolve())})

    def test_command_line_can_arm_snapshot_and_recover(self):
        source = self.base / 'source.json'
        target = self.base / 'target.json'
        source.write_text(json.dumps(SOURCE))
        target.write_text(json.dumps(TARGET))

        def run(*args):
            result = subprocess.run([sys.executable, str(ROOT / 'scripts/switch_transaction.py'),
                                     '--root', str(self.store.root), *map(str, args)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            return result.stdout

        run('create', 'cli', '--source', source, '--target', target)
        run('advance', 'cli', 'writers-stopped')
        run('snapshot', 'cli', 'settings', self.file)
        self.file.write_bytes(b'upstream')
        run('advance', 'cli', 'recovering')
        run('restore', 'cli')
        run('restore', 'cli')
        self.assertEqual(self.file.read_bytes(), b'original\n')
        self.assertEqual(json.loads(run('show', 'cli'))['phase'], 'recovering')

    def test_enospc_and_failures_on_each_publication_keep_old_or_new_complete_record(self):
        journal_path = self.base / 'transactions/roundtrip/journal.json'
        initial = journal_path.read_bytes()
        for method in ['fsync', 'replace']:
            real = getattr(os, method)
            for after in [False, True]:
                for boundary in range(1, 4 if method == 'fsync' else 2):
                    with self.subTest(method=method, after=after, boundary=boundary):
                        journal_path.write_bytes(initial)
                        count = 0

                        def fail(*args, **kwargs):
                            nonlocal count
                            count += 1
                            if count == boundary and not after:
                                raise OSError(errno.ENOSPC, 'injected full disk')
                            result = real(*args, **kwargs)
                            if count == boundary and after:
                                raise OSError(errno.ENOSPC, 'injected full disk')
                            return result

                        with patch.object(storage.os, method, fail), self.assertRaises(OSError):
                            self.store.advance('roundtrip', 'writers-stopped')
                        loaded = self.store.load('roundtrip')
                        self.assertIn(loaded['phase'], ['armed', 'writers-stopped'])
                        self.assertEqual(loaded['source'], SOURCE)
                        self.assertEqual(self.file.read_bytes(), b'original\n')

    def test_kill_before_and_after_snapshot_and_journal_publications(self):
        initial = (self.base / 'transactions/roundtrip/journal.json').read_bytes()
        for method, boundaries in [('fsync', 6), ('replace', 2)]:
            for boundary in range(1, boundaries + 1):
                for after in [False, True]:
                    with self.subTest(method=method, boundary=boundary, after=after):
                        (self.base / 'transactions/roundtrip/journal.json').write_bytes(initial)
                        code = '''
import os, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import switch_transaction as storage
store = storage.TransactionStore(Path(sys.argv[2]))
store.advance('roundtrip', 'writers-stopped')
real = getattr(os, sys.argv[4])
count = 0
def kill(*args, **kwargs):
    global count
    count += 1
    if count == int(sys.argv[5]) and sys.argv[6] == 'False': os._exit(91)
    result = real(*args, **kwargs)
    if count == int(sys.argv[5]) and sys.argv[6] == 'True': os._exit(91)
    return result
setattr(os, sys.argv[4], kill)
store.snapshot('roundtrip', 'settings', Path(sys.argv[3]))
'''
                        result = subprocess.run([sys.executable, '-c', code, str(ROOT / 'scripts'),
                                                 str(self.store.root), str(self.file), method, str(boundary), str(after)],
                                                capture_output=True, text=True)
                        self.assertEqual(result.returncode, 91, result.stderr)
                        journal = self.store.load('roundtrip')
                        self.assertEqual(journal['source'], SOURCE)
                        if 'settings' in journal['snapshots']:
                            self.file.write_bytes(b'changed')
                            self.store.advance('roundtrip', 'recovering')
                            self.store.restore_snapshots('roundtrip')
                        self.assertEqual(self.file.read_bytes(), b'original\n')

    def test_kill_during_arming_keeps_complete_journal_or_allows_pruning(self):
        for method, boundaries in [('mkdir', 1), ('fsync', 5), ('replace', 1)]:
            for boundary in range(1, boundaries + 1):
                for after in [False, True]:
                    transaction = 'arm-%s-%s-%s' % (method, boundary, after)
                    with self.subTest(transaction=transaction):
                        code = '''
import json, os, signal, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import switch_transaction as storage
real = getattr(os, sys.argv[4])
count = 0
def kill(*args, **kwargs):
    global count
    count += 1
    if count == int(sys.argv[5]) and sys.argv[6] == 'False': os.kill(os.getpid(), signal.SIGKILL)
    result = real(*args, **kwargs)
    if count == int(sys.argv[5]) and sys.argv[6] == 'True': os.kill(os.getpid(), signal.SIGKILL)
    return result
setattr(os, sys.argv[4], kill)
storage.TransactionStore(Path(sys.argv[2])).create(sys.argv[3], json.loads(sys.argv[7]), json.loads(sys.argv[8]))
'''
                        result = subprocess.run([sys.executable, '-c', code, str(ROOT / 'scripts'),
                                                 str(self.store.root), transaction, method, str(boundary), str(after),
                                                 json.dumps(SOURCE), json.dumps(TARGET)], capture_output=True, text=True)
                        self.assertEqual(result.returncode, -signal.SIGKILL, result.stderr)
                        directory = self.store.root / transaction
                        if (directory / 'journal.json').exists():
                            self.assertEqual(self.store.load(transaction)['source'], SOURCE)
                            self.assertEqual(self.store.load(transaction)['phase'], 'armed')
                        elif directory.exists():
                            self.assertEqual(self.store.protected_backups(), set())
                        self.assertEqual(self.file.read_bytes(), b'original\n')

    def test_symlink_and_absence_restore_repeat_after_failed_publications(self):
        missing = self.base / 'baseline.json'
        link = self.base / 'venv'
        link.symlink_to('original-env')
        self.store.advance('roundtrip', 'writers-stopped')
        self.store.snapshot('roundtrip', 'baseline', missing)
        self.store.snapshot('roundtrip', 'environment', link)
        self.store.advance('roundtrip', 'recovering')
        for method, boundaries in [('unlink', 1), ('symlink', 1), ('fsync', 3), ('replace', 1)]:
            real = getattr(os, method)
            for boundary in range(1, boundaries + 1):
                for after in [False, True]:
                    with self.subTest(method=method, boundary=boundary, after=after):
                        missing.write_bytes(b'upstream')
                        link.unlink()
                        link.symlink_to('upstream-env')
                        count = 0

                        def fail(*args, **kwargs):
                            nonlocal count
                            count += 1
                            if count == boundary and not after:
                                raise OSError(errno.ENOSPC, 'full disk')
                            result = real(*args, **kwargs)
                            if count == boundary and after:
                                raise OSError(errno.ENOSPC, 'full disk')
                            return result

                        with patch.object(storage.os, method, fail), self.assertRaises(OSError):
                            self.store.restore_snapshots('roundtrip')
                        self.store.restore_snapshots('roundtrip')
                        self.store.restore_snapshots('roundtrip')
                        self.assertFalse(missing.exists())
                        self.assertEqual(os.readlink(link), 'original-env')
                        self.assertEqual(self.store.load('roundtrip')['phase'], 'recovering')

    def test_pruning_keeps_references_even_after_commit_and_fails_closed_on_corruption(self):
        backups = self.base / 'backups'
        backups.mkdir()
        names = ['20260101-1200%02d_v3.6.1_switch.db' % number for number in range(6)]
        for number, name in enumerate(names):
            path = backups / name
            path.write_bytes(b'database')
            os.utime(path, (100 + number, 100 + number))
        self.store.add_backup('roundtrip', backups / names[0])
        self.store.add_backup('roundtrip', backups / names[1])
        for phase in ['writers-stopped', 'snapshots-ready', 'installing', 'validating', 'committed', 'cleaned']:
            self.store.advance('roundtrip', phase)
        unpublished = self.store.root / 'unpublished'
        unpublished.mkdir()
        (unpublished / '.pending-journal').write_bytes(b'incomplete journal')
        recover_switch.check_startup(self.store, 'free-sleep.service', self.base / 'no-lock')
        bin_dir = self.base / 'bin'
        bin_dir.mkdir()
        fake_df = bin_dir / 'df'
        fake_df.write_text('#!/bin/sh\necho "Filesystem blocks used available mounted"\necho "fake 1 1 1 /"\n')
        fake_df.chmod(0o755)
        env = {**os.environ, 'PATH': str(bin_dir) + ':' + os.environ['PATH'],
               'NIGHTSTAND_TRANSACTION_ROOT': str(self.store.root)}
        result = subprocess.run(['bash', str(ROOT / 'scripts/prune_db_snapshots.sh'), str(backups)],
                                env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sorted(path.name for path in backups.iterdir()), [names[0], names[1], names[5]])
        for number, name in enumerate(names):
            path = backups / name
            path.write_bytes(b'database')
            os.utime(path, (100 + number, 100 + number))
        alias = self.base / 'alias'
        alias.symlink_to(backups, target_is_directory=True)
        result = subprocess.run(['bash', str(ROOT / 'scripts/prune_db_snapshots.sh'), 'alias'], cwd=self.base,
                                env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sorted(path.name for path in backups.iterdir()), [names[0], names[1], names[5]])
        (self.store.root / 'roundtrip/journal.json').write_text('{}')
        result = subprocess.run(['bash', str(ROOT / 'scripts/prune_db_snapshots.sh'), str(backups)],
                                env=env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(list(backups.iterdir())), 3)


if __name__ == '__main__':
    unittest.main()
