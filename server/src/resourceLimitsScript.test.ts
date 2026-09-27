import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// scripts/setup_resource_limits.sh bounds our services so a runaway job
// cannot take memory from the pod's firmware. Run against a scratch systemd
// directory with systemctl stubbed out.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(repoRoot, 'scripts/setup_resource_limits.sh');

function runScript() {
  const root = mkdtempSync(path.join(tmpdir(), 'nightstand-limits-'));
  const bin = path.join(root, 'bin');
  const calls = path.join(root, 'systemctl-calls');
  execFileSync('mkdir', ['-p', bin]);
  writeFileSync(path.join(bin, 'systemctl'), `#!/bin/sh\necho "$@" >> "${calls}"\n`);
  chmodSync(path.join(bin, 'systemctl'), 0o755);
  execFileSync('bash', [SCRIPT], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, NIGHTSTAND_SYSTEMD_DIR: root },
  });
  const dropin = (unit: string) => readFileSync(path.join(root, `${unit}.d`, '10-nightstand-limits.conf'), 'utf8');
  return { dropin, calls: readFileSync(calls, 'utf8') };
}

describe('setup_resource_limits.sh', () => {
  it('parses and carries the exec bit', () => {
    assert.doesNotThrow(() => execFileSync('bash', ['-n', SCRIPT]));
    assert.ok(statSync(SCRIPT).mode & 0o111);
  });

  it('caps the server and makes its processes the preferred OOM victim', () => {
    const conf = runScript().dropin('free-sleep.service');
    assert.match(conf, /^\[Service\]$/m);
    assert.match(conf, /^MemoryMax=1200M$/m);
    assert.match(conf, /^OOMScoreAdjust=300$/m);
    assert.match(conf, /^MemoryAccounting=yes$/m);
  });

  it('caps the biometrics stream the same way', () => {
    const conf = runScript().dropin('free-sleep-stream.service');
    assert.match(conf, /^MemoryMax=512M$/m);
    assert.match(conf, /^OOMScoreAdjust=300$/m);
  });

  it('reloads systemd and restarts nothing itself', () => {
    const { calls } = runScript();
    assert.equal(calls.trim(), 'daemon-reload');
  });

  it('is installed by update.sh before the server starts', () => {
    const src = readFileSync(path.join(repoRoot, 'scripts/update.sh'), 'utf8');
    const install = src.indexOf('scripts/setup_resource_limits.sh');
    const start = src.indexOf('\nsystemctl start free-sleep\n');
    assert.ok(install > 0, 'update.sh must run setup_resource_limits.sh');
    assert.ok(start > install, 'the limits must be written before free-sleep starts');
  });

  it('is installed by ops/deploy.sh before the server starts', () => {
    const src = readFileSync(path.join(repoRoot, 'ops/deploy.sh'), 'utf8');
    const install = src.indexOf('scripts/setup_resource_limits.sh');
    const start = src.indexOf('SSH "systemctl start free-sleep"');
    assert.ok(install > 0, 'deploy.sh must run setup_resource_limits.sh');
    assert.ok(start > install, 'the limits must be written before free-sleep starts');
  });

  it('is installed by install.sh', () => {
    const src = readFileSync(path.join(repoRoot, 'scripts/install.sh'), 'utf8');
    assert.match(src, /scripts\/setup_resource_limits\.sh/);
  });
});
