import json
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import upstream_target

FIXTURES = json.loads((Path(__file__).parent / 'fixtures/upstream_targets.json').read_text())


class TargetTests(unittest.TestCase):
    def test_legacy_selector_ignores_v2(self):
        script = (Path(__file__).resolve().parents[1] / 'switch-to-upstream.sh').read_text()
        selector = script.split("SWITCH_PIN=$(printf '%s' \"$SWITCH_MANIFEST\" | python3 -c '\n", 1)[1].split("' 2>/dev/null)", 1)[0]
        for case in FIXTURES:
            with self.subTest(case=case['name']):
                output = io.StringIO()
                with patch.object(sys, 'stdin', io.StringIO(json.dumps(case['manifest']))), patch.object(sys, 'stdout', output):
                    exec(compile(selector, 'legacy upstream selector', 'exec'), {})
                self.assertEqual(output.getvalue().split()[1], 'ca7dc543119ae964dd10815c8ae0c80ddb9a4f8f')

    def test_shared_selection_fixtures(self):
        for case in FIXTURES:
            with self.subTest(case=case['name']):
                if case['expected'] is None:
                    with self.assertRaises(ValueError):
                        upstream_target.select_target(case['manifest'], case['confirmed'])
                else:
                    self.assertEqual(upstream_target.select_target(case['manifest'], case['confirmed']), case['expected'])
                self.assertEqual(case['manifest']['upstreamSwitch']['commit'],
                                 'ca7dc543119ae964dd10815c8ae0c80ddb9a4f8f')

    def test_download_identity_must_match_every_field(self):
        target = FIXTURES[1]['expected']
        upstream_target.verify_artifact(target, target['commit'], target['version'], target['treeSha256'])
        for values in [('a' * 40, target['version'], target['treeSha256']),
                       (target['commit'], '3.0.2', target['treeSha256']),
                       (target['commit'], target['version'], 'a' * 64)]:
            with self.subTest(values=values), self.assertRaises(ValueError):
                upstream_target.verify_artifact(target, *values)

    def test_command_line_rejects_explicit_invalid_confirmation(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = Path(directory) / 'manifest.json'
            confirmed = Path(directory) / 'confirmed.json'
            manifest.write_text(json.dumps(FIXTURES[1]['manifest']))
            command = [sys.executable, str(Path(upstream_target.__file__)), str(manifest)]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), FIXTURES[1]['expected'])
            for value in [None, {}, 'main', {**FIXTURES[1]['expected'], 'version': '3.0.2'}]:
                confirmed.write_text(json.dumps(value))
                with self.subTest(value=value):
                    result = subprocess.run(command + ['--confirmed', str(confirmed)], capture_output=True, text=True)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(result.stdout, '')


if __name__ == '__main__':
    unittest.main()
