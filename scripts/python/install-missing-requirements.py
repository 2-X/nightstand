"""Best-effort install of nats-py into an otherwise complete biometrics environment."""
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

# Pinned packages this step may add, with the modules that must import afterwards.
ALLOWED = {'nats-py': ('nats', 'nats.js.api')}
# nats-py takes under 1 MB with pip's temporary files; this keeps the step
# clear of the updater's own 64 MB space margin.
MIN_FREE_MB = 100
PIP_SECONDS = 120
IMPORT_SECONDS = 60
STAGING_PREFIX = '.nightstand-pip-'
IMPORT_CHECK = ('import importlib, sys\n'
                'if sys.argv[1] not in sys.path: sys.path.append(sys.argv[1])\n'
                'for name in sys.argv[2:]: importlib.import_module(name)\n')


def say(message):
    print(message, flush=True)


def site_packages():
    import sysconfig
    return sysconfig.get_paths()['purelib']


def canonical(name):
    return re.sub(r'[-_.]+', '-', name).lower()


def find_distribution(name, site):
    import importlib.metadata
    wanted = canonical(name)
    for distribution in importlib.metadata.distributions(path=[site]):
        if canonical(distribution.metadata['Name'] or '') == wanted:
            return distribution
    return None


def top_level_modules(distribution, name):
    listed = [line.strip() for line in (distribution.read_text('top_level.txt') or '').splitlines()]
    return [module for module in listed if module] or [canonical(name).replace('-', '_')]


def imports(site, modules):
    try:
        result = subprocess.run([sys.executable, '-c', IMPORT_CHECK, site, *modules],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=IMPORT_SECONDS)
    except subprocess.TimeoutExpired:
        return False
    return result.returncode == 0


def run_pip(target, requirement, env):
    subprocess.run([sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check', '--no-cache-dir',
                    '--no-deps', '--only-binary', ':all:', '--timeout', '5', '--retries', '0',
                    '--target', target, requirement], check=True, timeout=PIP_SECONDS, env=env)


def remove(path):
    if os.path.isdir(path) and not os.path.islink(path):
        shutil.rmtree(path, ignore_errors=True)
    elif os.path.lexists(path):
        os.unlink(path)


def install_one(site, requirement, modules):
    """Install into a staging folder beside the environment, then move it in; nothing half-installed stays."""
    staging = tempfile.mkdtemp(prefix=STAGING_PREFIX, dir=os.path.dirname(site))
    moved = []
    try:
        target = os.path.join(staging, 'target')
        say(f'Installing {requirement} for the live biometrics stream...')
        run_pip(target, requirement, dict(os.environ, TMPDIR=staging))
        # The dist-info goes last, so the package only counts as installed once it is all there.
        entries = sorted(os.listdir(target), key=lambda entry: entry.endswith('.dist-info'))
        present = [entry for entry in entries if os.path.lexists(os.path.join(site, entry))]
        if present:
            raise RuntimeError(f'not replacing existing {", ".join(present)}')
        for entry in entries:
            os.rename(os.path.join(target, entry), os.path.join(site, entry))
            moved.append(entry)
        if not imports(site, modules):
            raise RuntimeError(f'{requirement} did not import after installing; removed it')
        moved = []
        say(f'Installed {requirement}')
    finally:
        for entry in reversed(moved):
            remove(os.path.join(site, entry))
        shutil.rmtree(staging, ignore_errors=True)


def install_missing(requirements, site=None):
    try:
        site = site or site_packages()
        for stale in Path(os.path.dirname(site)).glob(STAGING_PREFIX + '*'):
            shutil.rmtree(stale, ignore_errors=True)
        from pip._vendor.packaging.requirements import Requirement
        wanted = []
        others = []
        for line in Path(requirements).read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            requirement = Requirement(line)
            if requirement.marker is not None and not requirement.marker.evaluate():
                continue
            if not any(spec.operator == '==' for spec in requirement.specifier):
                raise ValueError('Python requirements must be pinned')
            distribution = find_distribution(requirement.name, site)
            name = canonical(requirement.name)
            if name in ALLOWED:
                if distribution is None:
                    wanted.append((str(requirement), ALLOWED[name]))
            elif distribution is None:
                say(f'Biometrics install is incomplete ({requirement.name} is missing); not adding packages')
                return
            else:
                others.extend(top_level_modules(distribution, requirement.name))
        if not wanted:
            return
        if not imports(site, others):
            say('Biometrics packages do not import cleanly; not adding packages')
            return
        free_mb = shutil.disk_usage(site).free // (1024 * 1024)
        if free_mb < MIN_FREE_MB:
            say(f'Only {free_mb} MB free for Python packages, {MIN_FREE_MB} MB needed; not adding packages')
            return
        for requirement, modules in wanted:
            install_one(site, requirement, modules)
    except Exception as error:
        say(f'WARNING: optional biometrics packages were not installed: {error}')


if __name__ == '__main__':
    install_missing(sys.argv[1])
