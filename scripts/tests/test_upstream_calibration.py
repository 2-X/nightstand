"""Offline baseline transitions retain both forks' calibration files."""
import importlib.util
import os
from pathlib import Path
import sys
import signal
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
from switch_transaction import TransactionStore

spec = importlib.util.spec_from_file_location('prepare_upstream', SCRIPTS / 'prepare-upstream.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class BaselineTransitionTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.folder = Path(self.temporary.name) / 'data'
        self.folder.mkdir()
        self.store = TransactionStore(Path(self.temporary.name) / 'transactions')
        self.left = self.folder / 'left_cap_baseline.json'
        self.right = self.folder / 'right_cap_baseline.json'
        self.left.write_bytes(b'{"left_out":{"mean":12,"std":1}}\n')
        self.left.chmod(0o640)
        os.utime(self.left, ns=(1000000000, 2000000000))
        self.original = self.left.read_bytes()
        self.metadata = self.left.stat()
        self.create('forward', 'nightstand', 'upstream')

    def create(self, name, source, target):
        def identity(fork):
            return dict(fork=fork, commit='a' * 40, treeSha256='b' * 64,
                        version='3.0.3', treePath=str(self.folder.parent / fork))
        self.store.create(name, identity(source), identity(target))
        self.store.advance(name, 'writers-stopped')

    def snapshot(self, name):
        prepare.snapshot_baselines(self.store, name, self.folder)
        self.store.advance(name, 'snapshots-ready')

    def test_quarantine_and_recovery_restore_bytes_metadata_and_absence(self):
        self.snapshot('forward')
        prepare.quarantine_baselines(self.store, 'forward', self.folder)
        self.assertFalse(self.left.exists())
        self.right.write_bytes(b'upstream calibration')
        self.store.advance('forward', 'recovering')
        self.store.restore_snapshots('forward')
        status = self.left.stat()
        self.assertEqual((status.st_mode, status.st_uid, status.st_gid, status.st_atime_ns, status.st_mtime_ns),
                         (self.metadata.st_mode, self.metadata.st_uid, self.metadata.st_gid,
                          self.metadata.st_atime_ns, 2000000000))
        self.assertEqual(self.left.read_bytes(), self.original)
        self.assertFalse(self.right.exists())

    def test_interrupted_quarantine_can_be_recovered_repeatedly(self):
        self.right.write_bytes(b'ambiguous')
        self.snapshot('forward')
        with patch.object(prepare, 'fsync_directory', side_effect=OSError('interrupted')):
            with self.assertRaises(OSError):
                prepare.quarantine_baselines(self.store, 'forward', self.folder)
        self.store.advance('forward', 'recovering')
        for _ in range(2):
            self.store.restore_snapshots('forward')
            self.assertEqual(self.left.read_bytes(), self.original)
            self.assertEqual(self.right.read_bytes(), b'ambiguous')

    def test_return_preserves_latest_upstream_set_before_restoring_nightstand(self):
        self.snapshot('forward')
        prepare.quarantine_baselines(self.store, 'forward', self.folder)
        self.left.write_bytes(b'latest upstream left')
        self.right.write_bytes(b'latest upstream right')
        self.create('return', 'upstream', 'nightstand')
        self.snapshot('return')
        prepare.restore_baselines(self.store, 'return', 'forward', self.folder)
        self.assertEqual(self.left.read_bytes(), self.original)
        self.assertFalse(self.right.exists())
        self.store.advance('return', 'recovering')
        self.store.restore_snapshots('return')
        self.assertEqual(self.left.read_bytes(), b'latest upstream left')
        self.assertEqual(self.right.read_bytes(), b'latest upstream right')

    def test_interrupted_return_keeps_both_sets(self):
        self.snapshot('forward')
        self.left.write_bytes(b'new upstream')
        self.right.write_bytes(b'new upstream right')
        self.create('return', 'upstream', 'nightstand')
        self.snapshot('return')
        with patch.object(prepare, 'publish', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                prepare.restore_baselines(self.store, 'return', 'forward', self.folder)
        self.store.advance('return', 'recovering')
        self.store.restore_snapshots('return')
        self.assertEqual(self.left.read_bytes(), b'new upstream')
        self.assertEqual(self.right.read_bytes(), b'new upstream right')
        record = self.store.load('forward')['snapshots']['baseline-left']
        self.assertEqual((self.store.directory('forward') / record['backup']).read_bytes(), self.original)

    def test_mutation_without_complete_snapshots_is_refused(self):
        with self.assertRaises(ValueError):
            prepare.quarantine_baselines(self.store, 'forward', self.folder)
        self.assertEqual(self.left.read_bytes(), self.original)

    def test_kill_before_and_after_replacement_restores_latest_upstream_set(self):
        self.snapshot('forward')
        for boundary in ('before', 'after'):
            self.left.write_bytes(b'new upstream left')
            self.right.write_bytes(b'new upstream right')
            transaction = 'return-' + boundary
            self.create(transaction, 'upstream', 'nightstand')
            self.snapshot(transaction)
            script = '''
import importlib.util, os, signal, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from switch_transaction import TransactionStore
spec = importlib.util.spec_from_file_location('prepare', Path(sys.argv[1]) / 'prepare-upstream.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)
publish = prepare.publish
def interrupted(*args):
    if sys.argv[5] == 'after':
        publish(*args)
    os.kill(os.getpid(), signal.SIGKILL)
prepare.publish = interrupted
prepare.restore_baselines(TransactionStore(Path(sys.argv[2])), sys.argv[3], 'forward', Path(sys.argv[4]))
'''
            result = subprocess.run([sys.executable, '-B', '-c', script, str(SCRIPTS),
                                     str(self.store.root), transaction, str(self.folder), boundary],
                                    capture_output=True, timeout=10)
            self.assertEqual(result.returncode, -signal.SIGKILL, result.stderr)
            self.store.advance(transaction, 'recovering')
            for _ in range(2):
                self.store.restore_snapshots(transaction)
                self.assertEqual(self.left.read_bytes(), b'new upstream left')
                self.assertEqual(self.right.read_bytes(), b'new upstream right')

    def test_corrupt_retained_backup_refuses_return_before_any_replacement(self):
        self.snapshot('forward')
        self.left.write_bytes(b'upstream')
        self.right.write_bytes(b'upstream right')
        self.create('return', 'upstream', 'nightstand')
        self.snapshot('return')
        record = self.store.load('forward')['snapshots']['baseline-left']
        (self.store.directory('forward') / record['backup']).write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            prepare.restore_baselines(self.store, 'return', 'forward', self.folder)
        self.assertEqual(self.left.read_bytes(), b'upstream')
        self.assertEqual(self.right.read_bytes(), b'upstream right')


if __name__ == '__main__':
    unittest.main()
