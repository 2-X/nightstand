import assert from 'node:assert/strict';
import { it } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve('..');
function section(file: string, from: string, to?: string) {
  const src = readFileSync(path.join(root, file), 'utf8');
  const start = src.indexOf(from);
  assert.ok(start >= 0, `Missing boundary: ${from}`);
  const end = to ? src.indexOf(to, start) : src.length;
  assert.ok(end > start);
  return src.slice(start, end);
}
// Execute actual script sections with disposable trees. External service,
// network, ownership, and delay commands are replaced at their boundary.
function run(script: string, setup = '') {
  const dir = mkdtempSync(path.join(tmpdir(), 'nightstand-updater-'));
  for (const tree of ['live', 'prev']) {
    mkdirSync(path.join(dir, tree, 'server'), { recursive: true });
    writeFileSync(path.join(dir, tree, 'version'), tree === 'live' ? 'failed' : 'restored');
  }
  mkdirSync(path.join(dir, 'persistent/free-sleep-data/lowdb'), { recursive: true });
  const env = { ...process.env, FIXTURE: dir };
  const fixtureScript = script.replaceAll('/home/dac/free-sleep', `${dir}/live`)
    .replaceAll('/persistent/', `${dir}/persistent/`);
  const result = spawnSync('bash', ['-c', `set -uo pipefail
LIVE="$FIXTURE/live"; PREV="$FIXTURE/prev"; FAILED="$FIXTURE/failed"; TMP="$FIXTURE/tmp"
BK=backup; CUR_VERSION=3.0.0; TARGET_VERSION=3.1.0; MOVED_MODULES=no; STREAM_WAS_ACTIVE=active
NPM=npm; NPX=npx; SSH_PORT=22; DRY_RUN=yes
say() { echo "$*"; }
fail() { echo "$*"; exit 1; }
sleep() { :; }
chown() { :; }
nice() { shift 2; "$@"; }
ionice() { shift 4; "$@"; }
export -f nice ionice
curl() { return 0; }
systemctl() { echo "$* $(cat "$LIVE/version")" >> "$FIXTURE/services"; }
ssh_cmd() { echo "$*" >> "$FIXTURE/ssh"; echo 0; }
restore_and_report() { echo restored > "$FIXTURE/restored"; }
fix_shared_node_modules() { :; }
${section('scripts/rollback_pod.sh', 'restart_services() {', '# --- preflight')}
${setup}
${fixtureScript}`], { env, encoding: 'utf8', input: 'y\n', timeout: 5000 });
  const read = (name: string) => {
    try { return readFileSync(path.join(dir, name), 'utf8'); } catch { return ''; }
  };
  const output = {
    ...result, services: read('services'), ssh: read('ssh'), restored: read('restored'),
    liveVersion: read('live/version'), previousVersion: read('prev/version'), marker: read('marker'),
  };
  rmSync(dir, { recursive: true, force: true });
  return output;
}

it('a failed fork migration restores the original without starting the failed build', () => {
  const result = run(section('scripts/migrate/pod-installer.sh', 'say "Running prisma', '# --- health check'), 'sudo() { return 1; }');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(result.restored, 'restored\n');
  assert.equal(result.services, '');
});

for (const [file, marker] of [
  ['scripts/update.sh', '# --- automatic rollback'],
  ['scripts/rollback_pod.sh', '# --- swap back on failure'],
  ['scripts/revert-to-stock.sh', '# --- automatic rollback'],
]) {
  it(`${file} restarts biometrics from the restored tree after failure`, () => {
    const result = run(section(file, marker));
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.services, /stop free-sleep-stream failed/);
    assert.match(result.services, /(?:start|restart) free-sleep-stream restored/);
  });
}

it('dry-run with clock skew never writes the Pod clock', () => {
  const result = run(section('scripts/migrate/switch-to-this-fork.sh', '# Clock skew.', '# WAN state'));
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.ssh, /date -u -s/);
});

for (const [channel, wanted] of [['stable', '3.2.0'], ['beta', '3.3.0'], ['', '3.2.0']]) {
  it(`untargeted update honors ${channel || 'default stable'} channel`, () => {
    // Run the selection block followed by its public resolved target.
    const selected = run(
      section('scripts/update.sh', '# --- resolve what to install', '# --- download + stage') + '\necho "selected=$EXPECTED_VERSION"', `
TARGET_VERSION=''; CUR_VERSION=3.0.0; RELEASES_URL=fixture; TAG_ZIP_URL_PREFIX=tag-v
SETTINGS_FILE="$FIXTURE/settings.json"
printf '%s' '{"updateChannel":"${channel}"}' > "$SETTINGS_FILE"
open_wan() { :; }
curl() { echo '{"releases":[{"version":"3.3.0","channel":"beta"},{"version":"3.2.0","channel":"stable"}]}'; }
`);
    assert.equal(selected.status, 0, selected.stdout + selected.stderr);
    assert.match(selected.stdout, new RegExp(`selected=${wanted.replaceAll('.', '\\.')}`));
  });
}

for (const [target, allowDowngrade, status] of [['3.0.0', 'no', 1], ['3.0.0', 'yes', 0]]) {
  it(`explicit downgrade requires consent: ${allowDowngrade}`, () => {
    const result = run(
      section('scripts/update.sh', '# --- resolve what to install', '# --- download + stage') + '\necho "selected=$EXPECTED_VERSION"', `
TARGET_VERSION=${target}; CUR_VERSION=3.2.0; ALLOW_DOWNGRADE=${allowDowngrade}
RELEASES_URL=fixture; TAG_ZIP_URL_PREFIX=tag-v
open_wan() { :; }
curl() { echo '{"releases":[{"version":"3.0.0","channel":"stable"}]}'; }
`);
    assert.equal(result.status, status, result.stdout + result.stderr);
    if (status === 0) assert.match(result.stdout, /selected=3.0.0/);
  });
}
it('a missing manifest aborts an untargeted update', () => {
  const result = run(section('scripts/update.sh', '# --- resolve what to install', '# --- download + stage'), `
TARGET_VERSION=''; RELEASES_URL=fixture; SETTINGS_FILE="$FIXTURE/missing.json"
open_wan() { :; }
curl() { return 22; }
`);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /could not resolve a release/);
});
function runRestore(setup = '') {
  return run(section('scripts/migrate/switch-to-this-fork.sh', '  say "Extracting and restarting..."', '  say "Restore complete.'), `
RESTORE_TARBALL=backup
mkdir -p "$FIXTURE/archive/free-sleep/server/"{dist,public,node_modules}
printf restored > "$FIXTURE/archive/free-sleep/version"
touch "$FIXTURE/archive/free-sleep/server/dist/server.js" "$FIXTURE/archive/free-sleep/server/public/index.html"
echo '{"name":"fixture"}' > "$FIXTURE/archive/free-sleep/server/package.json"
echo dependency > "$FIXTURE/archive/free-sleep/server/node_modules/dependency"
tar czf "$FIXTURE/live-restore.tar.gz" -C "$FIXTURE/archive" .
ssh_cmd() { command bash -c "$2"; }
export -f systemctl chown
export LIVE
${setup}
`);
}

it('a corrupt restore archive leaves the live tree running and exits with failure', () => {
  const result = runRestore('echo corrupt > "$FIXTURE/live-restore.tar.gz"');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(result.liveVersion, 'failed');
  assert.equal(result.services, '');
});

it('a restore archive without installed dependencies leaves the live tree untouched', () => {
  const result = runRestore(`
rm -rf "$FIXTURE/archive/free-sleep/server/node_modules"
tar czf "$FIXTURE/live-restore.tar.gz" -C "$FIXTURE/archive" .
`);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(result.liveVersion, 'failed');
  assert.equal(result.services, '');
  assert.match(result.stderr, /Use.*Roll back|supply.*complete backup/i);
});

it('a complete restore archive replaces code and restarts active biometrics', () => {
  const result = runRestore(`
systemctl() {
  if [ "$1" = is-active ]; then echo active; else echo "$* $(cat "$LIVE/version")" >> "$FIXTURE/services"; fi
}
export -f systemctl
`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.liveVersion, 'restored');
  assert.match(result.services, /stop free-sleep-stream failed/);
  assert.match(result.services, /start free-sleep restored/);
  assert.match(result.services, /restart free-sleep-stream restored/);
  assert.match(result.stdout, /[0-9]+[KMGT]?\s+.*restore\.[^/]+\/previous/);
  assert.match(result.stdout, /remove.*after|after.*remove/i);
});

it('a restore service start failure is reported as failure', () => {
  const result = runRestore('systemctl() { [ "$1" != start ]; }; export -f systemctl');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /[0-9]+[KMGT]?\s+.*restore\.[^/]+\/previous/);
  assert.match(result.stdout, /remove.*after|after.*remove/i);
});

for (const mode of ['previous', 'backup']) {
  it(`ops rollback ${mode} restores the biometrics service with code`, () => {
    const script = section('ops/rollback.sh', 'if [ "${1:-}" = "--from" ]; then', '\nsleep 8');
    const result = run(script, `
BACKUPS="$FIXTURE/backups"
SSH() { echo "$*" > "$FIXTURE/ssh"; }
${mode === 'backup' ? 'set -- --from fixture' : 'set --'}
`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.ssh, /stop free-sleep-stream/);
    assert.match(result.ssh, /(?:start|restart) free-sleep-stream/);
  });
}

it('a failed restore remains an explicit failure and keeps the recovery sentinel armed', () => {
  const result = run(
    section('scripts/migrate/pod-installer.sh', 'restore_and_report() {', '\n# ===') +
      '\nrestore_and_report "migration failed"', `
RESTORE_SCRIPT_DEST=fixture
bash() { return 1; }
write_status() { echo "status: $*"; }
disarm_sentinel() { echo disarmed; }
`);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /status: install restore_failed/);
  assert.doesNotMatch(result.stdout, /disarmed/);
});

for (const failedSource of ['LIVE', 'PREV']) {
  it(`rollback recovery restarts the surviving tree when moving ${failedSource} fails`, () => {
    const result = run(section('scripts/rollback_pod.sh', '# --- swap back on failure'), `
mv() { if [ "$1" = "$${failedSource}" ]; then return 1; else command mv "$@"; fi; }
`);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.liveVersion, 'failed');
    assert.equal(result.previousVersion, 'restored');
    assert.match(result.services, /start free-sleep failed/);
    assert.match(result.services, /restart free-sleep-stream failed/);
  });
}

it('rollback recovery reports manual recovery when neither tree can be restored', () => {
  const result = run(section('scripts/rollback_pod.sh', '# --- swap back on failure'), `
mv() { if [ "$2" = "$LIVE" ]; then return 1; else command mv "$@"; fi; }
`);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(result.liveVersion, '');
  assert.doesNotMatch(result.services, /^start free-sleep/m);
  assert.match(result.stdout, /manual recovery required/);
});

it('a failed forward rollback bookkeeping move restores the original tree before exiting', () => {
  const result = run(section('scripts/rollback_pod.sh', '# --- swap', '# --- health check'), `
mv() { if [ "$1" = "$TMP" ] && [ "$2" = "$PREV" ]; then return 1; else command mv "$@"; fi; }
systemctl() {
  if [ "$1" = is-active ]; then echo active; else echo "$* $(cat "$LIVE/version")" >> "$FIXTURE/services"; fi
}
`);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(result.liveVersion, 'failed');
  assert.equal(result.previousVersion, 'restored');
  assert.match(result.services, /start free-sleep failed/);
  assert.match(result.services, /restart free-sleep-stream failed/);
});

for (const streamState of ['active', 'inactive']) {
  it(`a successful rollback preserves an ${streamState} biometrics service`, () => {
    const result = run(section('scripts/rollback_pod.sh', '# --- swap', '# --- health check'), `
systemctl() {
  if [ "$1" = is-active ]; then echo ${streamState}; else echo "$* $(cat "$LIVE/version")" >> "$FIXTURE/services"; fi
}
`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.liveVersion, 'restored');
    assert.equal(result.previousVersion, 'failed');
    assert.equal(result.services,
      'stop free-sleep-stream failed\nstop free-sleep failed\nstart free-sleep restored\n' +
      (streamState === 'active' ? 'restart free-sleep-stream restored\n' : ''));
  });
}

it('original-fork restore preserves the previous tree and sentinel when quarantine fails', () => {
  const result = run(section('scripts/migrate/restore-original-fork.sh', 'say "Swap marker present'), `
ABORTED_QUARANTINE="$FIXTURE/quarantine"; PREEXISTING_PREV="$FIXTURE/preexisting"
SWAP_MARKER="$FIXTURE/marker"; echo armed > "$SWAP_MARKER"
mv() { if [ "$1" = "$LIVE" ]; then return 1; else command mv "$@"; fi; }
restore_iptables() { :; }
write_status() { echo "status: $*"; }
disarm_sentinel() { echo disarmed; }
`);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /status: restore_failed/);
  assert.doesNotMatch(result.stdout, /disarmed|auto-restored/);
  assert.equal(result.previousVersion, 'restored');
  assert.equal(result.marker, 'armed\n');
});

it('a failed rollback bookkeeping move still starts the restored install', () => {
  const result = run(section('scripts/rollback_pod.sh', '# --- swap back on failure'), `
mv() { if [ "$1" = "$TMP" ] && [ "$2" = "$PREV" ]; then return 1; else command mv "$@"; fi; }
`);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(result.liveVersion, 'restored');
  assert.match(result.services, /start free-sleep restored/);
  assert.match(result.services, /restart free-sleep-stream restored/);
});

for (const file of ['scripts/update.sh', 'scripts/revert-to-stock.sh']) {
  for (const failedSource of ['LIVE', 'PREV']) {
    it(`${file} restarts the available tree when moving ${failedSource} fails during recovery`, () => {
      const result = run(section(file, '# --- automatic rollback'), `
mv() { if [ "$1" = "$${failedSource}" ]; then return 1; else command mv "$@"; fi; }
`);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.equal(result.liveVersion, 'failed');
      assert.equal(result.previousVersion, 'restored');
      assert.match(result.services, /start free-sleep failed/);
      assert.match(result.services, /restart free-sleep-stream failed/);
    });
  }
}

it('an invalid saved update channel fails before opening internet access', () => {
  const result = run(section('scripts/update.sh', '# --- resolve what to install', '# --- download + stage'), `
TARGET_VERSION=''; SETTINGS_FILE="$FIXTURE/settings.json"
echo '{"updateChannel":"invalid"}' > "$SETTINGS_FILE"
open_wan() { echo opened > "$FIXTURE/marker"; }
`);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(result.marker, '');
});

it('an incompatible migration history restores the original with an actionable message', () => {
  const result = run(section('scripts/migrate/pod-installer.sh', 'say "Running prisma', '# --- health check'), `
sudo() { case "$*" in *'migrate status'*) return 1;; *) return 0;; esac; }
restore_and_report() { echo "$*"; echo restored > "$FIXTURE/restored"; }
`);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(result.restored, 'restored\n');
  assert.equal(result.services, '');
  assert.match(result.stdout, /compare.*migration histories/i);
});

it('fork migration backups contain an independently restorable dependency tree', () => {
  const backupScript = section('scripts/migrate/switch-to-this-fork.sh', 'say "Stage 4:', 'say "Pulling the backup');
  const result = run(backupScript + '\ntar tzf "$REMOTE_BACKUP_TARBALL" > "$FIXTURE/marker"', `
mkdir -p "$LIVE/server/node_modules"
echo installed > "$LIVE/server/node_modules/dependency"
ssh_cmd() { command bash -c "$2"; }
`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.marker, /free-sleep\/server\/node_modules\/dependency/);
});

it('a failed rollback bookkeeping move recovers shared dependencies before starting', () => {
  const result = run(section('scripts/rollback_pod.sh', 'fix_shared_node_modules() {', '# --- preflight') +
    section('scripts/rollback_pod.sh', '# --- swap back on failure'), `
mkdir "$LIVE/server/node_modules"
echo same > "$LIVE/server/package-lock.json"
echo same > "$PREV/server/package-lock.json"
mv() { if [ "$1" = "$TMP" ] && [ "$2" = "$PREV" ]; then return 1; else command mv "$@"; fi; }
systemctl() { if [ "$1" = start ]; then [ -d "$LIVE/server/node_modules" ] && echo modules > "$FIXTURE/marker"; fi; }
`);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(result.marker, 'modules\n');
});

for (const failedMove of ['live', 'replacement']) {
  it(`a restore ${failedMove} move failure restarts the original install`, () => {
    const result = runRestore(`
mv() {
  if ${failedMove === 'live' ? '[ "$1" = "$LIVE" ]' : '[[ "$1" = */free-sleep ]]'}; then return 1; fi
  command mv "$@"
}
export -f mv
`);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.liveVersion, 'failed');
    assert.match(result.services, /start free-sleep failed/);
  });
}

it('a failed archive upload never starts the remote restore', () => {
  const uploadScript = section('scripts/migrate/switch-to-this-fork.sh',
    '  say "Pushing backup tarball..."', '  say "Extracting and restarting..."');
  const result = run(uploadScript + '\necho continued > "$FIXTURE/marker"', `
RESTORE_TARBALL=backup
scp_to_pod() { return 1; }
`);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(result.marker, '');
  assert.equal(result.liveVersion, 'failed');
});

it('a failed backup copy aborts without reporting a completed archive', () => {
  const backupScript = section('scripts/migrate/switch-to-this-fork.sh', 'say "Stage 4:', 'say "Pulling the backup');
  const result = run(backupScript + '\necho completed > "$FIXTURE/marker"', `
cp() { return 1; }
export -f cp
ssh_cmd() { command bash -c "$2"; }
`);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(result.marker, '');
  assert.equal(result.liveVersion, 'failed');
});

for (const hasIonice of [false, true]) {
  it(`migration backup lowers copy and archive priority with ionice ${hasIonice ? 'available' : 'absent'}`, () => {
    const result = run(section('scripts/migrate/switch-to-this-fork.sh', 'say "Stage 4:', 'say "Pulling the backup'), `
mkdir -p "$FIXTURE/persistent/free-sleep-data/lowdb"
ssh_cmd() { command bash -c "$2"; }
nice() { [ "$1 $2" = '-n 19' ] || return 1; shift 2; LOW_CPU=yes "$@"; }
cp() { [ "\${LOW_CPU:-}" = yes ] || return 1; ${hasIonice ? '[ "${LOW_IO:-}" = yes ] || return 1;' : ''} command cp "$@"; }
tar() { [ "\${LOW_CPU:-}" = yes ] || return 1; ${hasIonice ? '[ "${LOW_IO:-}" = yes ] || return 1;' : ''} command tar "$@"; }
${hasIonice
    ? 'ionice() { [ "$1 $2 $3 $4" = "-c 2 -n 7" ] || return 1; shift 4; LOW_IO=yes "$@"; }; export -f ionice'
    : 'command() { if [ "${1:-} ${2:-}" = "-v ionice" ]; then return 1; fi; builtin command "$@"; }; export -f command'}
export -f nice cp tar
`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.liveVersion, 'failed');
  });
}

for (const outcome of ['success', 'restored', 'failed', 'restore_failed']) {
  it(`migration archive retention runs only for ${outcome === 'success' ? 'successful' : 'unsuccessful'} outcome ${outcome}`, () => {
    const result = run(section('scripts/migrate/switch-to-this-fork.sh', 'say "Installer started.'), `
POD_IP=fixture; REMOTE_BACKUP_DIR="$FIXTURE/backups"; REMOTE_BACKUP_TARBALL=remote; LOCAL_BACKUP_TARBALL=local
mkdir -p "$REMOTE_BACKUP_DIR"
for number in 1 2 3 4; do touch -t "20260101000$number" "$REMOTE_BACKUP_DIR/migrate-$number.tar.gz"; done
touch "$REMOTE_BACKUP_DIR/keep.tar.gz"
ssh_cmd() {
  case "$2" in *migration-status.json*) echo '{"outcome":"${outcome}","stage":"done"}';;
    *) command bash -c "$2";;
  esac
}
trap 'ls "$REMOTE_BACKUP_DIR" > "$FIXTURE/marker"' EXIT
`);
    assert.equal(result.status, outcome === 'success' ? 0 : 1, result.stdout + result.stderr);
    assert.equal(result.marker, outcome === 'success'
      ? 'keep.tar.gz\nmigrate-3.tar.gz\nmigrate-4.tar.gz\n'
      : 'keep.tar.gz\nmigrate-1.tar.gz\nmigrate-2.tar.gz\nmigrate-3.tar.gz\nmigrate-4.tar.gz\n');
  });
}

it('an untargeted update refuses an archive labeled with a different version', () => {
  const result = run(section('scripts/update.sh', '# the pod runs prebuilt code', '# --- dependencies'), `
STAGE="$FIXTURE/stage"; TARGET_VERSION=''; EXPECTED_VERSION=3.2.0
mkdir -p "$STAGE/server/"{src,dist,public}
touch "$STAGE/server/dist/server.js" "$STAGE/server/public/index.html"
echo '{"version":"3.1.0"}' > "$STAGE/server/src/serverInfo.json"
`);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /but releases.json lists v3.2.0.*mislabeled release/);
  assert.equal(result.liveVersion, 'failed');
  assert.equal(result.services, '');
});

for (const { failedSources, expectedVersion } of [
  { failedSources: ['LIVE'], expectedVersion: 'failed' },
  { failedSources: ['PREV'], expectedVersion: 'failed' },
  { failedSources: ['TMP'], expectedVersion: 'restored' },
  { failedSources: ['TMP', 'LIVE'], expectedVersion: 'restored' },
  { failedSources: ['TMP', 'PREV'], expectedVersion: '' },
]) {
  it(`forward rollback preserves a tree when moves from ${failedSources.join(', ')} fail`, () => {
    const result = run(section('scripts/rollback_pod.sh', '# --- swap', '# --- health check'), `
moves=0
mv() {
  moves=$((moves + 1))
  if [ "$moves" -ge ${failedSources[0] === 'TMP' ? 3 : 1} ]; then
    case "$1" in ${failedSources.map(source => `"$${source}"`).join('|')}) return 1;; esac
  fi
  command mv "$@"
}
systemctl() {
  if [ "$1" = is-active ]; then echo active; else echo "$* $(cat "$LIVE/version")" >> "$FIXTURE/services"; fi
}
`);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.liveVersion, expectedVersion);
    if (!expectedVersion) {
      assert.doesNotMatch(result.services, /^start free-sleep/m);
      assert.match(result.stdout, /manual recovery required/);
    } else {
      assert.match(result.services, new RegExp(`start free-sleep ${result.liveVersion}`));
      assert.match(result.services, new RegExp(`restart free-sleep-stream ${result.liveVersion}`));
    }
  });
}
