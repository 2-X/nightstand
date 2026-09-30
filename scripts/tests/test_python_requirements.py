"""Biometrics Python packages install only at versions tested on Pods."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
REQUIREMENTS = ROOT / 'scripts/python/requirements.txt'


class PinnedRequirements(unittest.TestCase):
    def test_every_requirement_is_pinned(self):
        lines = [line.strip() for line in REQUIREMENTS.read_text().splitlines()]
        requirements = [line for line in lines if line and not line.startswith('#')]
        self.assertTrue(requirements)
        for line in requirements:
            self.assertRegex(line.split(';')[0].strip(), r'^[A-Za-z0-9_.-]+==[0-9][0-9A-Za-z.]*$', line)

    def test_scripts_and_ci_install_from_the_pinned_file(self):
        sources = sorted((ROOT / 'scripts').glob('*.sh')) + [ROOT / '.github/workflows/ci.yaml']
        for source in sources:
            for line in source.read_text().splitlines():
                if not re.search(r'pip3? install', line) or 'sentry-sdk==' in line:
                    continue
                self.assertTrue('requirements.txt' in line or 'pytest' == line.split()[-1],
                                f'{source.name}: {line.strip()}')


if __name__ == '__main__':
    unittest.main()
