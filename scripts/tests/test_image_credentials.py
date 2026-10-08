"""Check prebuilt-image cleanup against isolated files and fake system commands."""
import errno
import os
from pathlib import Path
import pty
import select
import subprocess
import tempfile
import time
import unittest


REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / 'scripts/check_image_credentials.sh'
PROFILE = '[connection]\nid=EyePhone\ntype=wifi\nautoconnect=true\n[wifi]\nssid=EyePhone\n[wifi-security]\nkey-mgmt=wpa-psk\npsk=fixture-key\n'
SHARED = '$6$TuDO46rILr$fixture-only'


class ImageCredentialsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'etc').mkdir()
        (self.root / 'bin').mkdir()
        self.shadow = self.root / 'etc/shadow'
        self.shadow.write_text(f'root:{SHARED}:0:0:99999:7:::\nrewt:{SHARED}:0:0:99999:7:::\n')
        self.profiles = []
        for directory in ['etc/NetworkManager/system-connections', 'persistent/system-connections']:
            folder = self.root / directory
            folder.mkdir(parents=True)
            profile = folder / 'EyePhone.nmconnection'
            profile.write_text(PROFILE)
            self.profiles.append(profile)
        self.calls = self.root / 'calls'
        for command in ['passwd', 'nmcli']:
            stub = self.root / 'bin' / command
            stub.write_text(f'#!/bin/sh\necho "{command} $*" >> "$CALLS"\nexit "${{COMMAND_STATUS:-0}}"\n')
            stub.chmod(0o755)
        self.script = self.root / 'check.sh'
        if SCRIPT.exists():
            self.script.write_text(SCRIPT.read_text().replace('/etc/', f'{self.root}/etc/')
                                   .replace('/persistent/', f'{self.root}/persistent/'))
        self.env = {**os.environ, 'PATH': f'{self.root}/bin:{os.environ["PATH"]}', 'CALLS': str(self.calls)}

    def run_check(self, answers=None):
        if answers is None:
            result = subprocess.run(['bash', self.script], input='yes\nyes\nyes\nyes\n',
                                    text=True, capture_output=True, env=self.env)
            self.assertEqual(result.returncode, 0, result.stderr)
            return result.stdout + result.stderr
        master, slave = pty.openpty()
        process = subprocess.Popen(['bash', self.script], stdin=slave, stdout=slave, stderr=slave, env=self.env)
        os.close(slave)
        output = bytearray()
        deadline = time.monotonic() + 10
        sent = 0
        try:
            while time.monotonic() < deadline:
                if select.select([master], [], [], 0.1)[0]:
                    try:
                        chunk = os.read(master, 4096)
                    except OSError as error:
                        if error.errno == errno.EIO:
                            break
                        raise
                    if not chunk:
                        break
                    output.extend(chunk)
                    prompts = output.count(b'[y/N]')
                    while sent < prompts and sent < len(answers):
                        os.write(master, (answers[sent] + '\n').encode())
                        sent += 1
                elif process.poll() is not None:
                    break
            self.assertIsNotNone(process.poll() if process.poll() is not None else process.wait(timeout=1))
            self.assertEqual(process.returncode, 0, output.decode())
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()
            os.close(master)
        return output.decode()

    def test_noninteractive_warns_without_changing_files_or_credentials(self):
        output = self.run_check()
        self.assertIn('root', output)
        self.assertIn('rewt', output)
        self.assertIn('EyePhone', output)
        self.assertNotIn(SHARED, output)
        self.assertNotIn('fixture-key', output)
        self.assertFalse(self.calls.exists())
        self.assertTrue(all(profile.exists() for profile in self.profiles))

    def test_unrelated_passwords_and_profiles_are_left_alone(self):
        self.shadow.write_text('root:$6$own-salt$fixture:0:0:99999:7:::\nrewt:!:0:0:99999:7:::\n')
        self.profiles[0].write_text(PROFILE.replace('ssid=EyePhone', 'ssid=MyNetwork'))
        self.profiles[1].rename(self.profiles[1].with_name('MyNetwork.nmconnection'))
        output = self.run_check()
        self.assertNotIn('WARNING', output)
        self.assertFalse(self.calls.exists())
        self.assertTrue(self.profiles[0].exists())

    def test_custom_eyephone_profile_is_only_a_possibly_inherited_candidate(self):
        custom = PROFILE.replace('autoconnect=true', 'autoconnect=false').replace('fixture-key', 'own-key')
        self.profiles[0].write_text(custom)
        self.profiles[1].unlink()
        self.shadow.write_text('root:!:0:0:99999:7:::\nrewt:!:0:0:99999:7:::\n')
        output = self.run_check(['no'])
        self.assertIn('possibly inherited', output)
        self.assertIn('Remove this possibly inherited EyePhone profile?', output)
        self.assertNotIn('own-key', output)
        self.assertFalse(self.calls.exists())
        self.assertEqual(self.profiles[0].read_text(), custom)

    def test_empty_answers_and_no_decline_every_action(self):
        self.run_check(['', 'no', '', 'no'])
        self.assertFalse(self.calls.exists())
        self.assertTrue(all(profile.exists() for profile in self.profiles))

    def test_each_action_requires_its_own_yes(self):
        self.run_check(['yes', 'no', 'yes', 'no'])
        self.assertEqual(self.calls.read_text().splitlines(), ['nmcli connection reload', 'passwd root'])
        self.assertFalse(self.profiles[0].exists())
        self.assertTrue(self.profiles[1].exists())
        self.assertIn(SHARED, self.shadow.read_text())

    def test_yes_can_replace_both_shared_passwords_and_remove_both_profiles(self):
        self.run_check(['yes', 'yes', 'yes', 'yes'])
        self.assertEqual(self.calls.read_text().splitlines(), [
            'nmcli connection reload', 'nmcli connection reload', 'passwd root', 'passwd rewt'])
        self.assertFalse(any(profile.exists() for profile in self.profiles))

    def test_only_the_account_with_the_reported_salt_is_prompted(self):
        self.shadow.write_text(f'root:$6$own-salt$fixture:0:0:99999:7:::\nrewt:{SHARED}:0:0:99999:7:::\n')
        for profile in self.profiles:
            profile.unlink()
        output = self.run_check(['yes'])
        self.assertEqual(self.calls.read_text().splitlines(), ['passwd rewt'])
        self.assertNotIn('root has', output)

    def test_failed_password_change_warns_without_aborting(self):
        self.env['COMMAND_STATUS'] = '1'
        output = self.run_check(['no', 'no', 'yes', 'no'])
        self.assertIn('WARNING: could not change the root password', output)
        self.assertEqual(self.calls.read_text().splitlines(), ['passwd root'])

    def test_missing_shadow_and_profiles_are_safe(self):
        self.shadow.unlink()
        for profile in self.profiles:
            profile.unlink()
        output = self.run_check()
        self.assertIn('could not read', output)
        self.assertFalse(self.calls.exists())


if __name__ == '__main__':
    unittest.main()
