import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Runs scripts/reset_db.sh (fs-reset-db) against a throwaway data folder and
// a real SQLite file, with systemctl and su replaced by stubs that record
// their arguments.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function makeDatabase(file: string) {
  execFileSync('python3', ['-c', `
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.execute('CREATE TABLE vitals (id INTEGER PRIMARY KEY, value TEXT)')
db.executemany('INSERT INTO vitals (value) VALUES (?)', [('x' * 200,)] * 2000)
db.commit()
db.close()
`, file]);
}

type Options = { database?: 'good' | 'none'; services?: string; migrateFails?: boolean };

function run(answer: string, { database = 'good', services = '{"biometrics":{"enabled":false}}', migrateFails = false }: Options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'nightstand-reset-db-'));
  const persistent = path.join(dir, 'persistent');
  const data = path.join(persistent, 'free-sleep-data');
  const backups = path.join(persistent, 'free-sleep-database-backups');
  const scripts = path.join(dir, 'scripts');
  const bin = path.join(dir, 'bin');
  mkdirSync(path.join(data, 'lowdb'), { recursive: true });
  mkdirSync(scripts);
  mkdirSync(bin);
  writeFileSync(path.join(data, 'lowdb', 'servicesDB.json'), services);
  const db = path.join(data, 'free-sleep.db');
  if (database !== 'none') makeDatabase(db);
  const original = existsSync(db) ? readFileSync(db) : null;
  const calls = path.join(dir, 'calls');
  const stub = (name: string, body: string) => {
    writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${calls}"\n${body}\n`);
    chmodSync(path.join(bin, name), 0o755);
  };
  stub('systemctl', 'exit 0');
  stub('su', `exit ${migrateFails ? 1 : 0}`);
  for (const helper of ['sqlite-safety.py', 'prune_db_snapshots.sh']) {
    copyFileSync(path.join(repoRoot, 'scripts', helper), path.join(scripts, helper));
  }
  const script = path.join(scripts, 'reset_db.sh');
  writeFileSync(script, readFileSync(path.join(repoRoot, 'scripts/reset_db.sh'), 'utf8').replaceAll('/persistent', persistent));
  const result = spawnSync('bash', [script], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, input: `${answer}\n`, encoding: 'utf8', timeout: 60_000,
  });
  const log = existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [];
  const saved = existsSync(backups) ? readdirSync(backups) : [];
  const read = (name: string) => readFileSync(path.join(backups, name));
  const out = { ...result, log, saved, read, original, dbLeft: existsSync(db), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  return out;
}

const integrity = (bytes: Buffer) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nightstand-check-'));
  const file = path.join(dir, 'copy.db');
  writeFileSync(file, bytes);
  const check = 'import sqlite3, sys; print(sqlite3.connect(sys.argv[1]).execute("PRAGMA integrity_check").fetchone()[0])';
  const answer = execFileSync('python3', ['-c', check, file], { encoding: 'utf8' }).trim();
  rmSync(dir, { recursive: true, force: true });
  return answer;
};

describe('reset_db.sh', () => {
  it('parses', () => {
    assert.equal(spawnSync('bash', ['-n', path.join(repoRoot, 'scripts/reset_db.sh')]).status, 0);
  });

  it('does nothing without a yes', () => {
    const result = run('n');
    assert.equal(result.status, 0);
    assert.deepEqual(result.log, []);
    assert.equal(result.dbLeft, true);
    result.cleanup();
  });

  it('saves a checked copy, recreates the database and starts the server', () => {
    const result = run('y');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const copy = result.saved.find((name) => /^\d{8}T\d{6}Z-\d+-reset\.db$/.test(name));
    assert.ok(copy, result.saved.join(', '));
    assert.equal(integrity(result.read(copy)), 'ok');
    assert.match(result.stdout, /Database backup saved to/);
    assert.equal(result.dbLeft, false);
    assert.ok(result.log.some((line) => line.startsWith('su ') && line.includes('prisma migrate deploy')));
    assert.ok(result.log.includes('systemctl start free-sleep'), result.log.join('\n'));
    result.cleanup();
  });

  it('starts the stream again only while Biometrics is on in the app', () => {
    const on = run('y', { services: '{"biometrics":{"enabled":true}}' });
    assert.equal(on.status, 0, on.stdout + on.stderr);
    assert.ok(on.log.includes('systemctl start free-sleep-stream'), on.log.join('\n'));
    on.cleanup();

    for (const services of ['{"biometrics":{"enabled":false}}', 'not json']) {
      const off = run('y', { services });
      assert.equal(off.status, 0, off.stdout + off.stderr);
      assert.ok(off.log.includes('systemctl stop free-sleep free-sleep-stream'));
      assert.ok(off.log.includes('systemctl start free-sleep'));
      assert.ok(!off.log.some((line) => /start [^\n]*free-sleep-stream/.test(line)), off.log.join('\n'));
      off.cleanup();
    }
  });

  it('starts the server, and not a switched-off stream, when the reset fails', () => {
    const result = run('y', { migrateFails: true });
    assert.notEqual(result.status, 0);
    assert.ok(result.log.includes('systemctl start free-sleep'), result.log.join('\n'));
    assert.ok(!result.log.some((line) => /start [^\n]*free-sleep-stream/.test(line)), result.log.join('\n'));
    result.cleanup();
  });
});
