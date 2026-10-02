"""Check the fork-switch ordering and execute cleanup with local fixtures."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]

class MigrationRecovery(unittest.TestCase):
    def test_database_is_checked_before_swap(self):
        script = (ROOT / 'scripts/migrate/pod-installer.sh').read_text()
        check = script.index('Database compatibility preflight')
        self.assertLess(check, script.index(': > "$SWAP_MARKER"'))
        preflight = script[check:script.index('# Dead-man sentinel')]
        self.assertIn('sqlite-safety.py', preflight)
        self.assertIn('DATABASE_URL=', preflight)
        self.assertIn('migrate deploy', preflight)
        self.assertNotIn('dotenv', preflight)

    def test_restore_cleans_only_owned_service_artifacts(self):
        source = (ROOT / 'scripts/migrate/restore-original-fork.sh').read_text()
        start = source.index('cleanup_nightstand_services() {')
        end = source.index('\n}\n', start) + 3
        with tempfile.TemporaryDirectory() as folder:
            systemd = Path(folder)
            names = ['free-sleep-archive-raw.service', 'free-sleep-archive-raw.timer', 'free-sleep-health.service', 'free-sleep-health.timer', 'free-sleep.service.d/10-nightstand-limits.conf', 'free-sleep-stream.service.d/10-nightstand-limits.conf', 'free-sleep.service.d/user.conf']
            for name in names:
                file = systemd / name
                file.parent.mkdir(exist_ok=True)
                file.write_text('fixture')
            result = subprocess.run(['bash', '-c', 'SYSTEMD_DIR="$1"; systemctl() { :; };\n' + source[start:end] + '\ncleanup_nightstand_services', 'test', folder], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            for name in names[:-1]:
                self.assertFalse((systemd / name).exists(), name)
            self.assertTrue((systemd / names[-1]).exists())

    def test_sentinel_terminates_installer_before_restoring(self):
        source = (ROOT / 'scripts/migrate/restore-original-fork.sh').read_text()
        self.assertLess(source.index('stop_active_installer'), source.index('if [ ! -f "$SWAP_MARKER" ]'))
        self.assertIn('"${1:-}" = "--sentinel"', source)
        self.assertIn('free-sleep-migrate.service', source)
        self.assertIn('free-sleep-migrate-sentinel.service', source)
        installer = (ROOT / 'scripts/migrate/pod-installer.sh').read_text()
        self.assertIn('ExecStart=/bin/bash $RESTORE_SCRIPT_DEST --sentinel', installer)
        self.assertIn('free-sleep-migrate.pid', installer)
        self.assertIn('rm -rf "$STAGE" "$STAGE.unzip"', installer)

if __name__ == '__main__':
    unittest.main()
