import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Runs scripts/enable_biometrics.sh with its helper scripts, the venv python
// and curl replaced by stubs that record what ran. A first install used to
// leave Biometrics reading off in the app while the stream ran.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function run({ installed = false, calibrationFails = false, refuseOn = false, natsImports = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'nightstand-enable-biometrics-'));
  const home = path.join(dir, 'home');
  const scripts = path.join(home, 'free-sleep', 'scripts');
  const bin = path.join(dir, 'bin');
  const calls = path.join(dir, 'calls');
  mkdirSync(scripts, { recursive: true });
  mkdirSync(path.join(home, 'free-sleep', 'biometrics', 'sleep_detection'), { recursive: true });
  mkdirSync(path.join(home, 'venv', 'bin'), { recursive: true });
  mkdirSync(bin);
  writeFileSync(path.join(scripts, 'is_biometrics_installed.py'), `import sys\nsys.exit(${installed ? 1 : 0})\n`);
  for (const name of ['unblock_internet_access.sh', 'block_internet_access.sh', 'setup_python.sh',
    'install_python_packages.sh', 'setup_streamer_service.sh']) {
    writeFileSync(path.join(scripts, name), `echo "${name}" >> "${calls}"\n`);
  }
  const executable = (file: string, body: string) => { writeFileSync(file, `#!/bin/sh\n${body}\n`); chmodSync(file, 0o755); };
  const python = `echo "python $*" >> "${calls}"\n[ "$1" = -c ] && exit ${natsImports ? 0 : 1}\nexit ${calibrationFails ? 1 : 0}`;
  executable(path.join(home, 'venv', 'bin', 'python'), python);
  // refuseOn: the server cannot turn the stream on yet (its sudo rule is
  // missing), so it answers 500 to a body that turns Biometrics on.
  executable(path.join(bin, 'curl'), [
    'for a in "$@"; do last="$a"; done',
    `body=$(echo "$last" | tr -d ' \\n'); echo "curl $body" >> "${calls}"`,
    refuseOn ? 'case "$body" in *\'"enabled":true\'*) exit 22 ;; esac' : ':',
  ].join('\n'));
  executable(path.join(bin, 'systemctl'), `echo "systemctl $*" >> "${calls}"`);
  const script = readFileSync(path.join(repoRoot, 'scripts/enable_biometrics.sh'), 'utf8').replaceAll('/home/dac', home);
  const result = spawnSync('bash', ['-c', script], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8', timeout: 10_000,
  });
  const log = existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [];
  rmSync(dir, { recursive: true, force: true });
  return { ...result, log };
}

const turnsOn = (line: string) => line.startsWith('curl') && line.includes('"enabled":true');

describe('enable_biometrics.sh', () => {
  it('turns Biometrics on in the app once a first install has finished', () => {
    const result = run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const on = result.log.findIndex(turnsOn);
    assert.ok(on >= 0, result.log.join('\n'));
    assert.ok(on > result.log.findIndex((line) => line.startsWith('python') && line.includes('calibrate')), 'after calibration');
    assert.ok(on > result.log.indexOf('block_internet_access.sh'), 'after the firewall is back');
  });

  it('leaves Biometrics off when the install fails', () => {
    const result = run({ calibrationFails: true });
    assert.notEqual(result.status, 0);
    assert.ok(!result.log.some(turnsOn), result.log.join('\n'));
  });

  it('records the install as healthy even when the switch cannot be turned on', () => {
    // After fs-reset this path is how Biometrics comes back; a refused switch
    // must not also lose the installation status the app checks.
    for (const installed of [true, false]) {
      const result = run({ installed, refuseOn: true });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.ok(result.log.some((line) => line.startsWith('curl') && line.includes('"status":"healthy"') && !line.includes('"enabled"')),
        result.log.join('\n'));
      assert.match(result.stdout, /Biometrics is installed\. Turn it on in Settings > Features\./);
    }
  });

  it('still turns it on when it was already installed', () => {
    const result = run({ installed: true });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(result.log.some(turnsOn), result.log.join('\n'));
  });

  // nats-py is installed in the venv or bundled with Nightstand, so nothing is downloaded for it.
  for (const natsImports of [true, false]) {
    it(`never downloads nats-py or opens the firewall for it (imports: ${natsImports})`, () => {
      const result = run({ installed: true, natsImports });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.ok(result.log.some(line => line.startsWith('python -c') && line.endsWith('/free-sleep/biometrics')), result.log.join('\n'));
      assert.ok(!result.log.some(line => /pip|internet_access/.test(line)), result.log.join('\n'));
      assert.match(result.stdout, natsImports ? /nats-py is available/ : /reads the RAW files instead/);
      assert.ok(result.log.some(turnsOn), result.log.join('\n'));
    });
  }

  it('finds the bundled nats-py with the venv check, without site-packages', () => {
    const script = readFileSync(path.join(repoRoot, 'scripts/enable_biometrics.sh'), 'utf8');
    const code = script.match(/venv\/bin\/python -c '([^']*import vendored, nats)'/);
    assert.ok(code, 'the nats check');
    const args = ['-S', '-c', `${code[1]}; print(nats.__file__)`, path.join(repoRoot, 'biometrics')];
    const result = spawnSync('python3', args, { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.startsWith(path.join(repoRoot, 'biometrics', 'vendor', 'nats')), result.stdout);
  });
});
