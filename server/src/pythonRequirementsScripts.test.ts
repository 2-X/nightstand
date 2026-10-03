import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VENV_PYTHON = '/home/dac/venv/bin/python';

function helperCall(source: string) {
  const start = source.indexOf(`if [ -x ${VENV_PYTHON} ]`);
  assert.ok(start > 0, 'missing optional Python package step');
  return { start, text: source.slice(start, source.indexOf('fi\n', start) + 3) };
}

function withFolder<T>(body: (folder: string) => T) {
  const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-python-'));
  try {
    return body(folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

function stubPython(folder: string, exitCode: number) {
  const python = path.join(folder, 'python');
  writeFileSync(python, `#!/bin/sh\necho helper >> "$CALL_LOG"\nprintf '%s\\n' "$@" > "$ARGS_LOG"\nexit ${exitCode}\n`);
  chmodSync(python, 0o755);
  return python;
}

function stage(folder: string) {
  const staged = path.join(folder, 'stage');
  mkdirSync(path.join(staged, 'scripts/python'), { recursive: true });
  writeFileSync(path.join(staged, 'scripts/python/install-missing-requirements.py'), '');
  return staged;
}

for (const script of ['scripts/update.sh', 'scripts/migrate/pod-installer.sh']) {
  describe(`${script} optional Python packages`, () => {
    const source = readFileSync(path.join(repoRoot, script), 'utf8');
    const step = helperCall(source);

    it('runs before stopping services, and re-runs itself under bash', () => {
      assert.ok(step.start > source.indexOf('trap cleanup'));
      assert.ok(step.start < source.indexOf('systemctl stop free-sleep-stream'));
      assert.match(source, /\[ -n "\$\{BASH_VERSION:-\}" \] \|\| exec bash "\$0" "\$@"/);
    });

    for (const [pythonPresent, pipExit] of [[true, 0], [true, 1], [false, 0]] as const) {
      it(`continues with venv=${pythonPresent} and pip status=${pipExit}, without touching the firewall`, () => {
        withFolder((folder) => {
          const python = pythonPresent ? stubPython(folder, pipExit) : path.join(folder, 'python');
          const staged = stage(folder);
          const result = spawnSync('bash', ['-c', `set -euo pipefail
say() { echo "$*"; }
open_wan() { echo unexpected; exit 9; }
close_wan() { echo unexpected; exit 9; }
iptables() { echo unexpected; exit 9; }
${step.text.replaceAll(VENV_PYTHON, python)}
echo continued`], {
            env: { ...process.env, STAGE: staged, CALL_LOG: path.join(folder, 'calls'), ARGS_LOG: path.join(folder, 'args') },
            encoding: 'utf8',
          });
          assert.equal(result.status, 0, result.stderr);
          assert.match(result.stdout, /continued/);
          assert.doesNotMatch(result.stdout, /unexpected/);
          if (pythonPresent) {
            assert.equal(readFileSync(path.join(folder, 'args'), 'utf8'),
              `${staged}/scripts/python/install-missing-requirements.py\n${staged}/scripts/python/requirements.txt\n`);
            if (pipExit) assert.match(result.stdout, /WARNING/);
          }
        });
      });
    }
  });
}

describe('scripts/update.sh runs the Python step while its own window is open', () => {
  const source = readFileSync(path.join(repoRoot, 'scripts/update.sh'), 'utf8');
  const from = source.indexOf('# --- dependencies (old server still running)');
  const to = source.indexOf('# Preserve archive retention');
  assert.ok(from > source.indexOf('\nopen_wan\n') && to > from);
  const dependencies = source.slice(from, to);
  const marker = /^HANDOFF_MARKER='([^']+)'$/m.exec(source)?.[1];
  assert.ok(marker);

  // Runs the real dependency section; only commands at its edges are stubbed.
  function run(handoff: string, newUpdaterHandsOff: boolean) {
    return withFolder((folder) => {
      const python = stubPython(folder, 0);
      const staged = stage(folder);
      mkdirSync(path.join(staged, 'server'), { recursive: true });
      mkdirSync(path.join(folder, 'live/server'), { recursive: true });
      for (const tree of [staged, path.join(folder, 'live')]) writeFileSync(path.join(tree, 'server/package-lock.json'), '{}');
      writeFileSync(path.join(staged, 'scripts/update.sh'), newUpdaterHandsOff ? `${marker}\n` : '');
      const calls = path.join(folder, 'calls');
      const result = spawnSync('bash', ['-c', `set -uo pipefail
say() { :; }
fail() { echo "fail $*" >> "$CALL_LOG"; exit 1; }
free_mb() { echo 100000; }
node_pin() { echo 24; }
node_fetch_mb() { echo 0; }
run_limited() { echo run_limited >> "$CALL_LOG"; }
close_wan() { echo close_wan >> "$CALL_LOG"; }
exec() { echo handoff >> "$CALL_LOG"; exit 0; }
LIVE="$FIXTURE/live"; MODULES_MB=400; SPACE_MARGIN_MB=64; NPM=npm
HANDOFF="${handoff}"; HANDOFF_MARKER='${marker}'; IS_DOWNGRADE=no; STAGED_VERSION=9.9.9
TARGET_VERSION=; RECHECK_IN_USE=no
${dependencies.replaceAll(VENV_PYTHON, python)}
echo swap >> "$CALL_LOG"`], {
        env: { ...process.env, FIXTURE: folder, STAGE: staged, CALL_LOG: calls, ARGS_LOG: path.join(folder, 'args') },
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      return readFileSync(calls, 'utf8').trim().split('\n');
    });
  }

  it('the downloading updater installs before closing the window and handing off', () => {
    assert.deepEqual(run('', true), ['helper', 'close_wan', 'handoff']);
  });

  it('an updater that finishes the update itself installs before closing the window', () => {
    assert.deepEqual(run('', false), ['helper', 'close_wan', 'swap']);
  });

  it('a handed-off run, which starts with the window closed, does not run it', () => {
    assert.deepEqual(run('1', true), ['swap']);
  });
});
