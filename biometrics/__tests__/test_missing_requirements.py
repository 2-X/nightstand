"""The optional nats-py installer, with pip stubbed and no network access."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / 'scripts/python/install-missing-requirements.py'
REQUIREMENTS = 'installed-demo==2.0\nnats-py==2.16.0\ninactive-demo==1.0; python_version < "2"\n'


def load_installer():
    spec = importlib.util.spec_from_file_location('missing_requirements', SCRIPT)
    installer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(installer)
    return installer


def add_package(folder, name, version, module, source=''):
    dist = Path(folder) / f'{name.replace("-", "_")}-{version}.dist-info'
    dist.mkdir(parents=True)
    (dist / 'METADATA').write_text(f'Metadata-Version: 2.1\nName: {name}\nVersion: {version}\n')
    (dist / 'top_level.txt').write_text(module + '\n')
    package = Path(folder) / module
    package.mkdir()
    (package / '__init__.py').write_text(source)


class InstallerTestCase(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.site = self.root / 'lib' / 'site-packages'
        self.site.mkdir(parents=True)
        add_package(self.site, 'installed-demo', '1.0', 'installed_demo_mod')
        self.requirements = self.root / 'requirements.txt'
        self.requirements.write_text(REQUIREMENTS)
        self.installer = load_installer()
        self.installer.ALLOWED = {'nats-py': ('nats_demo_mod',)}
        self.pip_calls = []

    def pip(self, source='', fail=None):
        def run_pip(target, requirement, env):
            self.pip_calls.append((target, requirement, env['TMPDIR']))
            add_package(target, 'nats-py', '2.16.0', 'nats_demo_mod', source)
            if fail is not None:
                raise fail
        return patch.object(self.installer, 'run_pip', side_effect=run_pip)

    def run_installer(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.installer.install_missing(str(self.requirements), str(self.site))
        return output.getvalue()

    def site_entries(self):
        return sorted(entry.name for entry in self.site.iterdir())

    def assert_untouched(self):
        self.assertEqual(self.site_entries(), ['installed_demo-1.0.dist-info', 'installed_demo_mod'])
        self.assertEqual(list(self.root.glob('lib/.nightstand-pip-*')), [])


class TestInstallMissing(InstallerTestCase):
    def test_installs_only_nats_py_into_a_complete_environment(self):
        with self.pip():
            output = self.run_installer()
        self.assertEqual(len(self.pip_calls), 1)
        target, requirement, tmpdir = self.pip_calls[0]
        self.assertEqual(requirement, 'nats-py==2.16.0')
        self.assertEqual(Path(tmpdir).parent, self.site.parent)
        self.assertIn('nats_demo_mod', self.site_entries())
        self.assertIn('nats_py-2.16.0.dist-info', self.site_entries())
        self.assertIsNotNone(self.installer.find_distribution('nats-py', str(self.site)))
        self.assertEqual(list(self.root.glob('lib/.nightstand-pip-*')), [])
        self.assertNotIn('WARNING', output)

    def test_does_nothing_when_nats_py_is_present(self):
        add_package(self.site, 'nats-py', '2.16.0', 'nats_demo_mod')
        with self.pip():
            self.run_installer()
        self.assertEqual(self.pip_calls, [])

    def test_an_incomplete_environment_gets_no_pip_call(self):
        self.requirements.write_text(REQUIREMENTS + 'numpy-missing-demo==2.0.2\n')
        with self.pip():
            output = self.run_installer()
        self.assertEqual(self.pip_calls, [])
        self.assertIn('incomplete', output)
        self.assert_untouched()

    def test_an_environment_that_does_not_import_gets_no_pip_call(self):
        (self.site / 'installed_demo_mod' / '__init__.py').write_text('raise ImportError("broken")\n')
        with self.pip():
            output = self.run_installer()
        self.assertEqual(self.pip_calls, [])
        self.assertIn('do not import', output)

    def test_low_disk_skips_with_a_log_line(self):
        self.installer.MIN_FREE_MB = 10 ** 12
        with self.pip():
            output = self.run_installer()
        self.assertEqual(self.pip_calls, [])
        self.assertIn('MB needed', output)
        self.assert_untouched()

    def test_a_pip_timeout_leaves_nothing_behind(self):
        with self.pip(fail=subprocess.TimeoutExpired('pip', self.installer.PIP_SECONDS)):
            output = self.run_installer()
        self.assertEqual(len(self.pip_calls), 1)
        self.assertIn('WARNING', output)
        self.assert_untouched()

    def test_a_package_that_does_not_import_is_removed(self):
        with self.pip(source='raise ImportError("half installed")\n'):
            output = self.run_installer()
        self.assertIn('did not import', output)
        self.assert_untouched()

    def test_never_replaces_files_already_in_the_environment(self):
        (self.site / 'nats_demo_mod').mkdir()
        (self.site / 'nats_demo_mod' / 'keep.py').write_text('')
        with self.pip():
            output = self.run_installer()
        self.assertIn('not replacing', output)
        self.assertTrue((self.site / 'nats_demo_mod' / 'keep.py').exists())
        self.assertNotIn('nats_py-2.16.0.dist-info', self.site_entries())

    def test_leftover_staging_from_a_killed_run_is_removed(self):
        (self.site.parent / '.nightstand-pip-old' / 'target').mkdir(parents=True)
        add_package(self.site, 'nats-py', '2.16.0', 'nats_demo_mod')
        self.run_installer()
        self.assertEqual(list(self.root.glob('lib/.nightstand-pip-*')), [])

    def test_unpinned_requirements_are_refused(self):
        self.requirements.write_text('nats-py>=2\n')
        with self.pip():
            output = self.run_installer()
        self.assertEqual(self.pip_calls, [])
        self.assertIn('WARNING', output)

    def test_pip_command_is_bounded_and_installs_to_the_staging_target(self):
        calls = []

        def run(command, **options):
            calls.append((command, options))
            raise subprocess.TimeoutExpired(command, options['timeout'])

        with patch.object(self.installer.subprocess, 'run', side_effect=run), \
                self.assertRaises(subprocess.TimeoutExpired):
            self.installer.run_pip('/staging/target', 'nats-py==2.16.0', {'TMPDIR': '/staging'})
        command, options = calls[0]
        self.assertEqual(command[1:4], ['-m', 'pip', 'install'])
        for flag in ('--no-deps', '--no-cache-dir', '--retries'):
            self.assertIn(flag, command)
        self.assertEqual(command[command.index('--target') + 1], '/staging/target')
        self.assertEqual(command[command.index('--only-binary') + 1], ':all:')
        self.assertTrue(0 < options['timeout'] <= 120)


class TestScript(unittest.TestCase):
    def test_missing_pip_is_nonfatal(self):
        with tempfile.TemporaryDirectory() as folder:
            requirements = Path(folder) / 'requirements.txt'
            requirements.write_text('missing-demo==1.0\n')
            result = subprocess.run([sys.executable, '-S', str(SCRIPT), str(requirements)],
                                    capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0)
        self.assertIn('WARNING', result.stdout)

    def test_end_to_end_in_a_scratch_environment(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            subprocess.run([sys.executable, '-m', 'venv', '--without-pip', str(root / 'venv')],
                           check=True, timeout=120)
            python = str(root / 'venv' / 'bin' / 'python')
            site = subprocess.run([python, '-c', 'import sysconfig; print(sysconfig.get_paths()["purelib"])'],
                                  capture_output=True, text=True, check=True).stdout.strip()
            add_package(site, 'installed-demo', '1.0', 'installed_demo_mod')
            stub = root / 'stub'
            (stub / 'pip' / '_vendor').mkdir(parents=True)
            (stub / 'pip' / '__init__.py').write_text('')
            # Only the requirement parser is real; pip itself is a stub that writes a package.
            vendor = Path(importlib.util.find_spec('pip._vendor.packaging').origin).parent.parent
            (stub / 'pip' / '_vendor' / '__init__.py').write_text(f'__path__.append({str(vendor)!r})\n')
            (stub / 'pip' / '__main__.py').write_text(
                'import json, os, sys\nfrom pathlib import Path\n'
                'Path(os.environ["PIP_LOG"]).write_text(json.dumps([sys.argv[1:], os.environ["TMPDIR"]]))\n'
                'target = Path(sys.argv[sys.argv.index("--target") + 1])\n'
                'for module in ("nats", "nats/js"):\n'
                '    (target / module).mkdir(parents=True)\n'
                '    (target / module / "__init__.py").write_text("")\n'
                '(target / "nats/js/api.py").write_text("")\n'
                '(target / "nats_py-2.16.0.dist-info").mkdir()\n'
                '(target / "nats_py-2.16.0.dist-info/METADATA").write_text("Name: nats-py\\nVersion: 2.16.0\\n")\n')
            requirements = root / 'requirements.txt'
            requirements.write_text(REQUIREMENTS)
            log = root / 'pip-log'
            result = subprocess.run([python, str(SCRIPT), str(requirements)], capture_output=True, text=True,
                                    timeout=60, env={**os.environ, 'PYTHONPATH': str(stub), 'PIP_LOG': str(log)})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn('WARNING', result.stdout)
            args, tmpdir = json.loads(log.read_text())
            self.assertEqual(args[-1], 'nats-py==2.16.0')
            self.assertEqual(Path(tmpdir).parent, Path(site).parent)
            check = subprocess.run([python, '-c', 'import nats.js.api, importlib.metadata as m; '
                                    'print(m.version("nats-py"))'], capture_output=True, text=True)
            self.assertEqual(check.stdout.strip(), '2.16.0', check.stderr)
            self.assertEqual(list(Path(site).parent.glob('.nightstand-pip-*')), [])


if __name__ == '__main__':
    unittest.main()
