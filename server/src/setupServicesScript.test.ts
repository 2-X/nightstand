import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// scripts/setup_services.sh installs the units and sudoers rules behind the
// app's Update, Roll back, Revert to stock, Reboot, and biometrics controls.
// install.sh, update.sh, and both migration installers share it, so these run
// it for real against a scratch systemd dir and sudoers file, with systemctl
// and visudo stubbed out.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(repoRoot, 'scripts/setup_services.sh');

function sandbox(opts: {
  existingSudoers?: string; visudoFails?: boolean; withoutHealthCheck?: boolean;
  withoutNetworkWatchdog?: boolean; withRecovery?: boolean; watchdog?: 'ok';
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'nightstand-services-'));
  const bin = path.join(root, 'bin');
  const systemd = path.join(root, 'systemd');
  const repo = path.join(root, 'repo');
  const calls = path.join(root, 'systemctl-calls');
  const sudoers = path.join(root, 'sudoers');
  for (const dir of [bin, systemd, path.join(repo, 'scripts', 'systemd')]) mkdirSync(dir, { recursive: true });
  const units = ['free-sleep-rollback.service', 'free-sleep-revert.service'];
  if (!opts.withoutHealthCheck) {
    units.push('free-sleep-health.service', 'free-sleep-health.timer');
    copyFileSync(path.join(repoRoot, 'scripts/health_check.sh'), path.join(repo, 'scripts/health_check.sh'));
  }
  if (!opts.withoutNetworkWatchdog) {
    units.push('free-sleep-network-watchdog.service', 'free-sleep-network-watchdog.timer');
    copyFileSync(path.join(repoRoot, 'scripts/network_watchdog.sh'), path.join(repo, 'scripts/network_watchdog.sh'));
  }
  if (opts.withRecovery) {
    units.push('free-sleep-recover-update.service', 'free-sleep-recover-update.timer');
    copyFileSync(path.join(repoRoot, 'scripts/restore_helpers.sh'), path.join(repo, 'scripts/restore_helpers.sh'));
    copyFileSync(path.join(repoRoot, 'scripts/recover_update.sh'), path.join(repo, 'scripts/recover_update.sh'));
  }
  for (const unit of units) {
    copyFileSync(path.join(repoRoot, 'scripts/systemd', unit), path.join(repo, 'scripts/systemd', unit));
  }
  writeFileSync(path.join(bin, 'systemctl'), `#!/bin/sh\necho "$@" >> "${calls}"\n`);
  if (opts.watchdog) {
    writeFileSync(
      path.join(repo, 'scripts', 'setup_watchdog.sh'),
      `echo "watchdog $*" >> "${calls}"\nexit 0\n`,
    );
  }
  writeFileSync(path.join(bin, 'visudo'), `#!/bin/sh\nexit ${opts.visudoFails ? 1 : 0}\n`);
  chmodSync(path.join(bin, 'systemctl'), 0o755);
  chmodSync(path.join(bin, 'visudo'), 0o755);
  if (opts.existingSudoers !== undefined) writeFileSync(sudoers, opts.existingSudoers);

  const run = () => spawnSync('bash', [SCRIPT, repo], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      NIGHTSTAND_SYSTEMD_DIR: systemd,
      NIGHTSTAND_RECOVERY_DIR: path.join(root, 'recovery'),
      NIGHTSTAND_SUDOERS_FILE: sudoers,
    },
  });
  const read = (file: string) => readFileSync(file, 'utf8');
  return { run, read, systemd, sudoers, calls };
}

// Every command the server runs through sudo, read from its source.
function serverSudoCommands(): string[] {
  const jobsDir = path.join(repoRoot, 'server/src/jobs');
  const commands: string[] = [];
  for (const file of readdirSync(jobsDir)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    const src = readFileSync(path.join(jobsDir, file), 'utf8');
    for (const m of src.matchAll(/spawn\(\s*'sudo',\s*\[([^\]]*)\]/g)) {
      commands.push([...m[1].matchAll(/'([^']*)'/g)].map((arg) => arg[1]).join(' '));
    }
    for (const match of src.matchAll(/runPrivilegedCommand\(\s*\[([^\]]*)\]/g)) {
      commands.push([...match[1].matchAll(/'([^']*)'/g)].map(argument => argument[1]).join(' '));
    }
    for (const m of src.matchAll(/exec\(\s*'sudo ([^']*)'/g)) commands.push(m[1]);
  }
  return commands;
}

describe('setup_services.sh', () => {
  it('parses and carries the exec bit', () => {
    assert.doesNotThrow(() => execFileSync('bash', ['-n', SCRIPT]));
  });

  it('installs the update, rollback, and revert units without starting them', () => {
    const box = sandbox();
    const result = box.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const unit of ['free-sleep-update.service', 'free-sleep-rollback.service', 'free-sleep-revert.service']) {
      assert.ok(box.read(path.join(box.systemd, unit)).length > 0, `${unit} was not installed`);
    }
    const calls = box.read(box.calls).trim().split('\n');
    assert.deepEqual(calls, ['daemon-reload', 'enable --now free-sleep-health.timer', 'enable --now free-sleep-network-watchdog.timer']);
  });

  it('installs and starts the health check timer after the reload', () => {
    const box = sandbox();
    const first = box.run();
    assert.equal(first.status, 0, first.stdout + first.stderr);
    for (const unit of ['free-sleep-health.service', 'free-sleep-health.timer']) {
      assert.equal(
        box.read(path.join(box.systemd, unit)),
        readFileSync(path.join(repoRoot, 'scripts/systemd', unit), 'utf8'),
        `${unit} was not installed`,
      );
    }
    const second = box.run();
    assert.equal(second.status, 0, second.stdout + second.stderr);
    const calls = box.read(box.calls).trim().split('\n');
    assert.deepEqual(calls, [
      'daemon-reload', 'enable --now free-sleep-health.timer', 'enable --now free-sleep-network-watchdog.timer',
      'daemon-reload', 'enable --now free-sleep-health.timer', 'enable --now free-sleep-network-watchdog.timer',
    ]);
  });

  it('installs and starts the network watchdog timer after the reload', () => {
    const box = sandbox();
    const result = box.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const unit of ['free-sleep-network-watchdog.service', 'free-sleep-network-watchdog.timer']) {
      assert.equal(
        box.read(path.join(box.systemd, unit)),
        readFileSync(path.join(repoRoot, 'scripts/systemd', unit), 'utf8'),
        `${unit} was not installed`,
      );
    }
  });

  it('skips the network watchdog on a tree that does not carry it', () => {
    const box = sandbox({ withoutNetworkWatchdog: true });
    const result = box.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(box.read(box.calls).trim().split('\n'), ['daemon-reload', 'enable --now free-sleep-health.timer']);
    assert.equal(existsSync(path.join(box.systemd, 'free-sleep-network-watchdog.timer')), false);
  });

  it('skips the health check on a tree that does not carry it', () => {
    // The agent overlay installs this script onto upstream free-sleep without
    // the health check, and must not fail for it.
    const box = sandbox({ withoutHealthCheck: true, withoutNetworkWatchdog: true });
    const result = box.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(box.read(box.calls).trim(), 'daemon-reload');
    assert.equal(existsSync(path.join(box.systemd, 'free-sleep-health.timer')), false);
  });

  it('leaves the hardware watchdog to the caller, after its success check', () => {
    const box = sandbox({ watchdog: 'ok' });
    const result = box.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(box.read(box.calls), /^watchdog /m);
  });

  it('installs an enabled boot recovery unit whose helper survives a missing live tree', () => {
    const box = sandbox({ withRecovery: true });
    const result = box.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const unit = box.read(path.join(box.systemd, 'free-sleep-recover-update.service'));
    const helper = /^ExecStart=\/bin\/bash (.+)$/m.exec(unit)?.[1];
    assert.ok(helper);
    assert.equal(box.read(helper), readFileSync(path.join(repoRoot, 'scripts/recover_update.sh'), 'utf8'));
    assert.match(unit, /^Type=oneshot$/m);
    assert.match(unit, /^After=.*free-sleep\.service/m);
    assert.match(unit, /^ConditionPathExists=\/persistent\/free-sleep-data\/update-swap\.json$/m);
    assert.match(box.read(box.calls), /^enable free-sleep-recover-update\.timer$/m);
    assert.doesNotMatch(box.read(box.calls), /(?:start|--now) free-sleep-recover-update/);
  });

  it('grants a sudoers rule for every command the server runs through sudo', () => {
    const box = sandbox();
    box.run();
    const rules = box.read(box.sudoers).split('\n');
    const commands = serverSudoCommands();
    assert.ok(commands.length >= 5, `expected the server's sudo calls, found ${commands.length}`);
    for (const command of commands) {
      assert.ok(
        rules.some((rule) => rule.endsWith(`NOPASSWD: ${command}`)),
        `no sudoers rule for "sudo ${command}"`,
      );
    }
  });

  it('grants exactly these rules, and only enable --now on the stream unit', () => {
    // The Biometrics switch turns the stream on through one fixed command.
    // A broader grant (a wildcard, another verb or unit) would let the server
    // user control any service as root.
    const box = sandbox();
    box.run();
    const rules = box.read(box.sudoers).trim().split('\n');
    assert.deepEqual(rules, [
      'dac ALL=(ALL) NOPASSWD: /sbin/reboot',
      'dac ALL=(root) NOPASSWD: /bin/systemctl start free-sleep-update.service --no-block',
      'dac ALL=(root) NOPASSWD: /bin/systemctl start free-sleep-rollback.service --no-block',
      'dac ALL=(root) NOPASSWD: /bin/systemctl start free-sleep-revert.service --no-block',
      'dac ALL=(ALL) NOPASSWD: /bin/sh /home/dac/free-sleep/scripts/enable_biometrics.sh',
      'dac ALL=(ALL) NOPASSWD: /bin/sh /home/dac/free-sleep/scripts/disable_biometrics.sh',
      'dac ALL=(root) NOPASSWD: /bin/systemctl enable --now free-sleep-stream.service',
    ]);
    assert.ok(rules.every((rule) => !/[*?[\]]/.test(rule.split('NOPASSWD:')[1])), 'no wildcards');
  });

  it('keeps existing rules and adds nothing twice', () => {
    const existing = 'dac ALL=(ALL) NOPASSWD: /sbin/reboot\ndac ALL=(ALL) NOPASSWD: /usr/bin/something-else\n';
    const box = sandbox({ existingSudoers: existing });
    box.run();
    const once = box.read(box.sudoers);
    assert.ok(once.startsWith(existing), 'existing lines must be kept as they were');
    box.run();
    const twice = box.read(box.sudoers);
    assert.equal(twice, once, 'a second run must not change the file');
    const lines = twice.trim().split('\n');
    assert.equal(new Set(lines).size, lines.length, 'no rule may appear twice');
  });

  it('leaves the sudoers file alone and fails when visudo rejects the result', () => {
    const existing = 'dac ALL=(ALL) NOPASSWD: /sbin/reboot\n';
    const box = sandbox({ existingSudoers: existing, visudoFails: true });
    const result = box.run();
    assert.notEqual(result.status, 0);
    assert.equal(box.read(box.sudoers), existing);
  });
});
