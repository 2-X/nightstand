import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  chmodSync, lutimesSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(repoRoot, 'scripts/prune_db_snapshots.sh');
const DAY = 86_400;

const snapshotName = (index: number) => `20260101-1200${String(index).padStart(2, '0')}_v3.0.0_update.db`;

type Extra = { name: string; days: number };

type Options = {
  setup?: (snapshots: string, dir: string, now: number) => void;
  args?: (snapshots: string) => string[];
  after?: (dir: string) => unknown;
};

function run(ages: number[], freeMb: number, extras: Extra[] = [], env: Record<string, string> = {}, options: Options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'nightstand-prune-'));
  const snapshots = path.join(dir, 'snaps');
  const bin = path.join(dir, 'bin');
  mkdirSync(snapshots);
  mkdirSync(bin);
  const now = Math.floor(Date.now() / 1000);
  const put = (name: string, days: number) => {
    const file = path.join(snapshots, name);
    writeFileSync(file, 'x');
    utimesSync(file, now - days * DAY, now - days * DAY);
  };
  ages.forEach((days, index) => put(snapshotName(index), days));
  extras.forEach(({ name, days }) => put(name, days));
  options.setup?.(snapshots, dir, now);
  const fakeDf = `#!/bin/sh\necho "Filesystem 1024-blocks Used Available Capacity Mounted"\necho "fake 0 0 ${freeMb * 1024} 0% /"\n`;
  writeFileSync(path.join(bin, 'df'), fakeDf);
  chmodSync(path.join(bin, 'df'), 0o755);
  const fullEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env };
  const args = [SCRIPT, snapshots, ...(options.args?.(snapshots) ?? [])];
  const result = spawnSync('bash', args, { env: fullEnv, encoding: 'utf8' });
  const left = readdirSync(snapshots).sort();
  const extra = options.after?.(dir);
  rmSync(dir, { recursive: true, force: true });
  return { ...result, left, extra };
}

const names = (...indexes: number[]) => indexes.map(snapshotName).sort();

describe('prune_db_snapshots.sh', () => {
  it('keeps the newest three and anything younger than a week', () => {
    const result = run([0, 1, 2, 3, 10, 20], 5000);
    assert.equal(result.status, 0);
    assert.deepEqual(result.left, names(0, 1, 2, 3));
    assert.match(result.stdout, new RegExp(`Removed old database snapshot ${snapshotName(4)}`));
    assert.match(result.stdout, new RegExp(`Removed old database snapshot ${snapshotName(5)}`));
  });

  it('orders by age, not by name', () => {
    const result = run([20, 10, 9, 8, 0, 30], 5000);
    assert.deepEqual(result.left, names(2, 3, 4));
  });

  it('removes oldest first while space is short, but never the newest', () => {
    assert.deepEqual(run([0, 1, 2], 10).left, names(0));
    assert.deepEqual(run([5, 6, 7], 10).left, names(0));
  });

  it('stops removing once space is back over the floor', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nightstand-prune-'));
    const snapshots = path.join(dir, 'snaps');
    const bin = path.join(dir, 'bin');
    mkdirSync(snapshots);
    mkdirSync(bin);
    const now = Math.floor(Date.now() / 1000);
    [0, 1, 2, 3].forEach((days, index) => {
      const file = path.join(snapshots, snapshotName(index));
      writeFileSync(file, 'x');
      utimesSync(file, now - days * DAY, now - days * DAY);
    });
    // Each removal frees 250 MB, starting from 100 MB against a 512 MB floor.
    writeFileSync(path.join(bin, 'df'), [
      '#!/bin/sh',
      `n=$(ls "${snapshots}" | wc -l | tr -d ' ')`,
      'free=$(( (4 - n) * 250 + 100 ))',
      'echo "Filesystem 1024-blocks Used Available Capacity Mounted"',
      'echo "fake 0 0 $((free * 1024)) 0% /"',
      '',
    ].join('\n'));
    chmodSync(path.join(bin, 'df'), 0o755);
    const result = spawnSync('bash', [SCRIPT, snapshots], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
    const left = readdirSync(snapshots).sort();
    rmSync(dir, { recursive: true, force: true });
    assert.equal(result.status, 0);
    assert.deepEqual(left, names(0, 1));
  });

  it('honours NIGHTSTAND_SNAPSHOT_FLOOR_MB', () => {
    assert.deepEqual(run([0, 1, 2], 100, [], { NIGHTSTAND_SNAPSHOT_FLOOR_MB: '50' }).left, names(0, 1, 2));
    assert.deepEqual(run([0, 1, 2], 100, [], { NIGHTSTAND_SNAPSHOT_FLOOR_MB: '5000' }).left, names(0));
  });

  it('prunes by age alone when free space cannot be read', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nightstand-prune-'));
    const snapshots = path.join(dir, 'snaps');
    const bin = path.join(dir, 'bin');
    mkdirSync(snapshots);
    mkdirSync(bin);
    const now = Math.floor(Date.now() / 1000);
    [0, 1, 2, 30].forEach((days, index) => {
      const file = path.join(snapshots, snapshotName(index));
      writeFileSync(file, 'x');
      utimesSync(file, now - days * DAY, now - days * DAY);
    });
    writeFileSync(path.join(bin, 'df'), '#!/bin/sh\nexit 1\n');
    chmodSync(path.join(bin, 'df'), 0o755);
    const result = spawnSync('bash', [SCRIPT, snapshots], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
    const left = readdirSync(snapshots).sort();
    rmSync(dir, { recursive: true, force: true });
    assert.equal(result.status, 0);
    assert.deepEqual(left, names(0, 1, 2));
  });

  it('does nothing with an empty or missing folder', () => {
    assert.equal(run([], 5000).status, 0);
    assert.equal(spawnSync('bash', [SCRIPT, '/nonexistent']).status, 0);
  });

  it('only ever removes Nightstand snapshot files', () => {
    const others = [
      'free-sleep.db', 'notes.db', 's0.db', '.db', 'x_update.db', 'migrate-20260101.db',
      `${snapshotName(0)}.bak`, `old-${snapshotName(0)}`, `${snapshotName(0)}-journal`, 'README', 'a b.db',
      '20260101T120000Z-12-migration.db',
    ];
    const result = run([0, 1, 2, 3, 40], 10, others.map((name) => ({ name, days: 90 })));
    assert.equal(result.status, 0);
    assert.deepEqual(result.left, [...others, snapshotName(0)].sort());
  });

  it('recognises every name the installer, updater, switch and reset write', () => {
    const real = [
      '20260101-120000_v3.0.0_update.db', '20260101-120000_v3.4.1-beta.2_switch.db',
      '20260101T120000Z-4321-install.db', '20260101T120000Z-4321-reset.db',
    ];
    const result = run([], 10, [{ name: '20260301T120000Z-1-install.db', days: 1 }, ...real.map((name) => ({ name, days: 60 }))]);
    assert.deepEqual(result.left, ['20260301T120000Z-1-install.db']);
    assert.equal(result.stdout.trim().split('\n').length, real.length);
  });

  it('leaves directories and symlinks that carry a snapshot name, even when old and short of space', () => {
    const linkName = snapshotName(10);
    const dirName = snapshotName(11);
    const result = run([0, 1, 2], 10, [], {}, {
      setup: (snapshots, dir, now) => {
        writeFileSync(path.join(dir, 'outside.db'), 'keep');
        symlinkSync(path.join(dir, 'outside.db'), path.join(snapshots, linkName));
        mkdirSync(path.join(snapshots, dirName));
        const old = now - 90 * DAY;
        lutimesSync(path.join(snapshots, linkName), old, old);
        utimesSync(path.join(snapshots, dirName), old, old);
      },
      after: (dir) => readFileSync(path.join(dir, 'outside.db'), 'utf8'),
    });
    assert.equal(result.status, 0);
    assert.deepEqual(result.left, [snapshotName(0), linkName, dirName].sort());
    assert.equal(result.extra, 'keep');
    assert.doesNotMatch(result.stdout, new RegExp(`${linkName}|${dirName}`));
  });

  it('never removes the snapshot it is told was just written, whatever its age', () => {
    const justWritten = snapshotName(9);
    const setup = (snapshots: string, _dir: string, now: number) => {
      // Three snapshots stamped while the clock ran ahead, then the clock stepped back.
      [2, 3, 4].forEach((days, index) => {
        const file = path.join(snapshots, snapshotName(20 + index));
        writeFileSync(file, 'x');
        utimesSync(file, now + days * DAY, now + days * DAY);
      });
      writeFileSync(path.join(snapshots, justWritten), 'x');
      utimesSync(path.join(snapshots, justWritten), now, now);
    };
    const without = run([], 10, [], {}, { setup });
    assert.ok(!without.left.includes(justWritten));
    const withArg = run([], 10, [], {}, { setup, args: (snapshots) => [path.join(snapshots, justWritten)] });
    assert.equal(withArg.status, 0);
    assert.ok(withArg.left.includes(justWritten));
    assert.ok(withArg.left.includes(snapshotName(22)));
    assert.doesNotMatch(withArg.stdout, new RegExp(justWritten));
  });

  it('keeps the snapshot it is told was just written even when the clock stepped back over a week', () => {
    const justWritten = snapshotName(9);
    const setup = (snapshots: string, _dir: string, now: number) => {
      writeFileSync(path.join(snapshots, justWritten), 'x');
      utimesSync(path.join(snapshots, justWritten), now - 10 * DAY, now - 10 * DAY);
    };
    const without = run([0, 1, 2], 5000, [], {}, { setup });
    assert.ok(!without.left.includes(justWritten));
    const withArg = run([0, 1, 2], 5000, [], {}, { setup, args: (snapshots) => [path.join(snapshots, justWritten)] });
    assert.equal(withArg.status, 0);
    assert.deepEqual(withArg.left, [...names(0, 1, 2), justWritten].sort());
  });

  it('does not treat a path prefix as the snapshot folder', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nightstand-prune-'));
    const snapshots = path.join(dir, 'snaps');
    const sibling = path.join(dir, 'snaps-extra');
    mkdirSync(snapshots);
    mkdirSync(sibling);
    const old = Math.floor(Date.now() / 1000) - 90 * DAY;
    for (const folder of [snapshots, sibling]) {
      for (let index = 0; index < 5; index += 1) {
        const file = path.join(folder, snapshotName(index));
        writeFileSync(file, 'x');
        utimesSync(file, old, old);
      }
    }
    const result = spawnSync('bash', [SCRIPT, `${snapshots}/`], { env: { ...process.env }, encoding: 'utf8' });
    const left = [readdirSync(snapshots).length, readdirSync(sibling).length];
    rmSync(dir, { recursive: true, force: true });
    assert.equal(result.status, 0);
    assert.deepEqual(left, [3, 5]);
  });

  it('exits 0 and keeps going when a snapshot cannot be removed', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nightstand-prune-'));
    const snapshots = path.join(dir, 'snaps');
    mkdirSync(snapshots);
    const old = Math.floor(Date.now() / 1000) - 90 * DAY;
    for (let index = 0; index < 5; index += 1) {
      const file = path.join(snapshots, snapshotName(index));
      writeFileSync(file, 'x');
      utimesSync(file, old - index, old - index);
    }
    chmodSync(snapshots, 0o555);
    const result = spawnSync('bash', [SCRIPT, snapshots], { env: { ...process.env }, encoding: 'utf8' });
    chmodSync(snapshots, 0o755);
    const count = readdirSync(snapshots).length;
    rmSync(dir, { recursive: true, force: true });
    assert.equal(result.status, 0);
    if (process.getuid?.() !== 0) {
      assert.equal(count, 5);
      assert.doesNotMatch(result.stdout, /Removed/);
    }
  });

  it('re-executes under bash when started by another shell', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    assert.match(src, /BASH_VERSION[^\n]*exec bash "\$0"/);
  });

  it('runs before the update gates and again after the new snapshot', () => {
    for (const script of ['update.sh', 'switch-to-upstream.sh']) {
      const src = readFileSync(path.join(repoRoot, 'scripts', script), 'utf8');
      const calls = src.match(/bash "\$PRUNE_SNAPSHOTS"[^\n]*\|\| true/g) ?? [];
      assert.equal(calls.length, 2, script);
      const first = src.indexOf('bash "$PRUNE_SNAPSHOTS"');
      assert.ok(first > 0 && first < src.indexOf('ROOT_FREE=$(free_mb /)'), script);
      const second = src.indexOf('bash "$PRUNE_SNAPSHOTS"', src.indexOf('Database snapshot kept separately'));
      assert.ok(second > 0, script);
      assert.match(calls[1], /"\$DB_BACKUP"/);
    }
  });

  it('finds the script next to the running updater, so the first update prunes too', () => {
    for (const script of ['update.sh', 'switch-to-upstream.sh']) {
      const src = readFileSync(path.join(repoRoot, 'scripts', script), 'utf8');
      assert.match(src, /^PRUNE_SNAPSHOTS="\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/prune_db_snapshots\.sh"$/m, script);
      assert.doesNotMatch(src, /\$LIVE\/scripts\/prune_db_snapshots\.sh/, script);
      assert.equal((src.match(/\[ -f "\$PRUNE_SNAPSHOTS" \]/g) ?? []).length, 2, script);
    }
  });

  it('runs after the install and reset snapshots without failing them', () => {
    const install = readFileSync(path.join(repoRoot, 'scripts/install.sh'), 'utf8');
    assert.ok(install.indexOf('prune_db_snapshots.sh') > install.indexOf('Database backup saved to $DEST'));
    assert.match(install, /prune_db_snapshots\.sh[^\n]*"\$DEST"[^\n]*\|\| true/);
    const reset = readFileSync(path.join(repoRoot, 'scripts/reset_db.sh'), 'utf8');
    assert.ok(reset.indexOf('prune_db_snapshots.sh') > reset.indexOf('Database backup saved to $BACKUP'));
    assert.match(reset, /prune_db_snapshots\.sh[^\n]*"\$BACKUP"[^\n]*\|\| true/);
  });
});
