import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Runs scripts/reset.sh against a throwaway data folder, with systemctl,
// sudo and chown replaced by stubs that record their arguments.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOCK = '/persistent/deviceinfo/dac.sock';

function run(answer: string, {
  migrateExit = 0, stopFails = false, watchdogMark = undefined as string | undefined, rmKeepsServices = false,
} = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'nightstand-reset-'));
  const persistent = path.join(dir, 'persistent');
  const data = path.join(persistent, 'free-sleep-data');
  const bin = path.join(dir, 'bin');
  mkdirSync(path.join(data, 'lowdb'), { recursive: true });
  mkdirSync(bin);
  writeFileSync(path.join(data, 'lowdb', 'settingsDB.json'), '{"timeZone":"UTC"}');
  writeFileSync(path.join(data, 'free-sleep.db'), 'db');
  writeFileSync(path.join(data, 'dac_sock_path.txt'), `${SOCK}\n`);
  if (watchdogMark !== undefined) writeFileSync(path.join(data, 'watchdog-trial'), watchdogMark);
  const siblings = ['free-sleep-backups', 'free-sleep-database-backups', 'free-sleep-data-extra'];
  for (const name of siblings) {
    mkdirSync(path.join(persistent, name));
    writeFileSync(path.join(persistent, name, 'keep'), name);
  }
  const calls = path.join(dir, 'calls');
  const stub = (name: string, body: string) => {
    writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${calls}"\n${body}\n`);
    chmodSync(path.join(bin, name), 0o755);
  };
  stub('systemctl', `[ "$1" = is-active ] && echo active\n${stopFails ? '[ "$1 $2" = "stop free-sleep" ] && exit 1\n' : ''}exit 0`);
  stub('sudo', `exit ${migrateExit}`);
  stub('chown', 'exit 0');
  // A removal that fails partway and leaves the Biometrics switch behind.
  if (rmKeepsServices) {
    writeFileSync(path.join(data, 'lowdb', 'servicesDB.json'), '{"biometrics":{"enabled":true}}');
    stub('rm', 'find "$2" -type f ! -name servicesDB.json -delete; exit 1');
  }
  const script = readFileSync(path.join(repoRoot, 'scripts/reset.sh'), 'utf8')
    .replaceAll('/persistent', persistent)
    .replaceAll('/home/dac', path.join(dir, 'home'));
  const result = spawnSync('bash', ['-c', script], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, input: `${answer}\n`, encoding: 'utf8', timeout: 10_000,
  });
  const log = existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [];
  const read = (name: string) => (existsSync(path.join(data, name)) ? readFileSync(path.join(data, name), 'utf8') : null);
  const out = {
    ...result, log,
    sock: read('dac_sock_path.txt'),
    watchdogMark: read('watchdog-trial'),
    settingsLeft: existsSync(path.join(data, 'lowdb', 'settingsDB.json')),
    dbLeft: existsSync(path.join(data, 'free-sleep.db')),
    lowdbDir: existsSync(path.join(data, 'lowdb')),
    siblingsKept: siblings.every(name => existsSync(path.join(persistent, name, 'keep'))),
  };
  rmSync(dir, { recursive: true, force: true });
  return out;
}

describe('reset.sh', () => {
  it('parses, re-runs itself under bash, and never runs the updater with sh', () => {
    const file = path.join(repoRoot, 'scripts/reset.sh');
    assert.equal(spawnSync('bash', ['-n', file]).status, 0);
    const head = readFileSync(file, 'utf8').split('\n').slice(0, 6).join('\n');
    assert.match(head, /BASH_VERSION/);
    assert.doesNotMatch(readFileSync(file, 'utf8'), /update\.sh/);
  });

  it('does nothing without a yes', () => {
    const result = run('n');
    assert.equal(result.status, 0);
    assert.deepEqual(result.log.filter(line => !line.startsWith('systemctl is-active')), []);
    assert.equal(result.settingsLeft, true);
  });

  it('deletes the data but keeps the socket path, migrates, and starts the server', () => {
    const result = run('y');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.settingsLeft, false);
    assert.equal(result.dbLeft, false);
    assert.equal(result.lowdbDir, true);
    assert.equal(result.siblingsKept, true);
    assert.equal(result.sock, `${SOCK}\n`);
    const stopAt = result.log.indexOf('systemctl stop free-sleep');
    const migrateAt = result.log.findIndex(line => line.startsWith('sudo') && line.includes('run migrate'));
    const startAt = result.log.lastIndexOf('systemctl start free-sleep');
    assert.ok(stopAt >= 0 && stopAt < migrateAt && migrateAt < startAt, result.log.join('\n'));
    // Biometrics reads off once its settings are deleted, so the stream
    // stays stopped and is not started at boot either.
    assert.ok(result.log.includes('systemctl disable free-sleep-stream'), result.log.join('\n'));
    assert.ok(!result.log.some(line => /(start|restart|enable) free-sleep-stream/.test(line)), result.log.join('\n'));
    assert.match(result.stdout, /Backups in \S*\/persistent\/free-sleep-backups and \S*\/persistent\/free-sleep-database-backups are kept/);
  });

  // A failed watchdog trial can reset the Pod; trying it again after a
  // reset could reset it once more. An owner's --remove note stays too.
  it('keeps the watchdog trial record as it was', () => {
    for (const mark of ['PID 1 did not take the device\n', 'turned off by the owner with --remove\n', '']) {
      const result = run('y', { watchdogMark: mark });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(result.settingsLeft, false);
      assert.equal(result.watchdogMark, mark);
    }
    assert.equal(run('y').watchdogMark, null, 'a Pod without one does not get one');
    const watchdog = readFileSync(path.join(repoRoot, 'scripts/setup_watchdog.sh'), 'utf8');
    assert.match(watchdog, /:-\/persistent\/free-sleep-data\/watchdog-trial\}/, 'the file setup_watchdog.sh reads');
  });

  it('restores the stream when the removal left the Biometrics switch behind', () => {
    const result = run('y', { rmKeepsServices: true });
    assert.ok(result.log.includes('systemctl restart free-sleep-stream'), result.log.join('\n'));
    assert.ok(!result.log.includes('systemctl disable free-sleep-stream'), result.log.join('\n'));
  });

  it('still starts the server when the database cannot be created', () => {
    const result = run('y', { migrateExit: 1 });
    assert.notEqual(result.status, 0);
    assert.ok(result.log.includes('systemctl start free-sleep'));
    assert.match(result.stdout, /database could not be created/);
  });

  it('deletes nothing when the server cannot be stopped', () => {
    const result = run('y', { stopFails: true });
    assert.notEqual(result.status, 0);
    assert.equal(result.settingsLeft, true);
    assert.equal(result.dbLeft, true);
    assert.equal(result.sock, `${SOCK}\n`);
    assert.equal(result.siblingsKept, true);
    assert.ok(result.log.includes('systemctl start free-sleep'));
    // Nothing was deleted, so Biometrics still reads as it did.
    assert.ok(result.log.includes('systemctl restart free-sleep-stream'), result.log.join('\n'));
    assert.ok(!result.log.includes('systemctl disable free-sleep-stream'));
  });
});
