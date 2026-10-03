"""The bundled nats-py: unchanged from its wheel, importable on its own, and second to an installed copy."""
import base64
import csv
import hashlib
import os
import subprocess
import sys
import tempfile
import unittest

BIOMETRICS = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
VENDOR = os.path.join(BIOMETRICS, 'vendor')
DIST_INFO = 'nats_py-2.16.0.dist-info'


def run_python(code, *options):
    return subprocess.run([sys.executable, *options, '-c', code], capture_output=True, text=True, timeout=60)


class VendoredNats(unittest.TestCase):
    def test_files_match_the_wheel_record(self):
        with open(os.path.join(VENDOR, DIST_INFO, 'RECORD'), newline='') as record:
            rows = list(csv.reader(record))
        listed = set()
        for path, digest, _size in rows:
            listed.add(path)
            if not digest:
                continue
            algorithm, expected = digest.split('=', 1)
            with open(os.path.join(VENDOR, path), 'rb') as handle:
                actual = base64.urlsafe_b64encode(hashlib.new(algorithm, handle.read()).digest()).rstrip(b'=')
            self.assertEqual(actual.decode(), expected, path)
        for folder in ('nats', DIST_INFO):
            for root, dirs, files in os.walk(os.path.join(VENDOR, folder)):
                dirs[:] = [name for name in dirs if name != '__pycache__']
                for name in files:
                    self.assertIn(os.path.relpath(os.path.join(root, name), VENDOR), listed)

    def test_imports_with_the_standard_library_alone(self):
        # -S leaves out site-packages, so only the bundled copy can answer.
        result = run_python(
            f'import sys\nsys.path.insert(0, {BIOMETRICS!r})\n'
            'import vendored, nats, nats.js.api, nats.js.errors, nats.aio.client\n'
            'print(nats.__file__); print(nats.aio.client.__version__)\n', '-S')
        self.assertEqual(result.returncode, 0, result.stderr)
        path, version = result.stdout.split()
        self.assertTrue(path.startswith(VENDOR + os.sep), path)
        self.assertEqual(version, '2.16.0')

    def test_an_installed_copy_comes_first(self):
        with tempfile.TemporaryDirectory() as site:
            os.mkdir(os.path.join(site, 'nats'))
            open(os.path.join(site, 'nats', '__init__.py'), 'w').close()
            result = run_python(
                f'import sys\nsys.path.insert(0, {site!r})\nsys.path.insert(0, {BIOMETRICS!r})\n'
                'import vendored, nats\nprint(nats.__file__)\n', '-S')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(result.stdout.strip().startswith(site), result.stdout)

    def test_the_readers_load_it_before_importing_nats(self):
        for name in ('nats_source.py', os.path.join('stream', 'stream.py')):
            with open(os.path.join(BIOMETRICS, name)) as handle:
                source = handle.read()
            self.assertIn('\nimport vendored  # noqa: F401\n', source, name)
            self.assertLess(source.index('import vendored'), source.index('import nats'), name)


if __name__ == '__main__':
    unittest.main()
