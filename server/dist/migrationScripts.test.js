import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The fork-switch tool is the
// highest-stakes script in this repo: it runs against someone ELSE's pod,
// possibly mid-sleep. It can't be unit-tested against a real second fork's
// pod, so this gates the same class of invariant updaterScripts.test.ts and
// rollbackScript.test.ts gate for update.sh/rollback_pod.sh: parses, and the
// documented safety ordering is actually present in the source, in the
// right order, not just present anywhere in the file.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPTS = [
    'scripts/migrate/switch-to-this-fork.sh',
    'scripts/migrate/pod-installer.sh',
    'scripts/migrate/restore-original-fork.sh',
];
function readScript(relPath) {
    return readFileSync(path.join(repoRoot, relPath), 'utf8');
}
function assertOrder(src, markers, label) {
    let lastIdx = -1;
    for (const marker of markers) {
        // Search forward from just after the previous marker, indexOf() alone
        // would keep matching the same (possibly earlier) occurrence, e.g. a
        // function's definition instead of its later call site.
        const idx = src.indexOf(marker, lastIdx + 1);
        assert.ok(idx !== -1, `${label}: expected to find "${marker}" after the previous marker`);
        lastIdx = idx;
    }
}
describe('fork-switch tool scripts', () => {
    for (const script of SCRIPTS) {
        it(`${script} exists, parses (bash -n), and carries the exec bit`, () => {
            const full = path.join(repoRoot, script);
            assert.equal(existsSync(full), true, `${script} is missing`);
            assert.doesNotThrow(() => execFileSync('bash', ['-n', full]));
            const mode = statSync(full).mode;
            assert.ok(mode & 0o111, `${script} must carry the exec bit`);
        });
        it(`${script} passes shellcheck when available (non-fatal)`, () => {
            const full = path.join(repoRoot, script);
            try {
                execFileSync('which', ['shellcheck'], { stdio: 'ignore' });
            }
            catch {
                return; // shellcheck not installed on this machine, skip, don't fail CI-of-one
            }
            try {
                execFileSync('shellcheck', ['-S', 'error', full], { stdio: 'pipe' });
            }
            catch (err) {
                console.warn(`shellcheck warnings for ${script}:\n${err.stdout?.toString?.() ?? err}`);
            }
        });
    }
    it('data-compat-check.mjs exists and parses', () => {
        const full = path.join(repoRoot, 'scripts/migrate/data-compat-check.mjs');
        assert.equal(existsSync(full), true);
        assert.doesNotThrow(() => execFileSync('node', ['--check', full]));
    });
    describe('switch-to-this-fork.sh ordering', () => {
        const src = readScript('scripts/migrate/switch-to-this-fork.sh');
        it('never modifies anything before the typed "switch" confirmation', () => {
            assertOrder(src, [
                "Type 'switch' to proceed",
                'Stage 4: backing up the pod',
            ], 'switch-to-this-fork.sh');
        });
        it('takes the iptables snapshot pre-consent (before the typed confirmation)', () => {
            assertOrder(src, [
                'IPTABLES_SNAPSHOT_LOCAL=$(mktemp)',
                "Type 'switch' to proceed",
            ], 'switch-to-this-fork.sh');
        });
        it('double-verifies the backup (pod + laptop, size match) before pushing the installer', () => {
            assertOrder(src, [
                'Backup verified in both places',
                'Stage 5: pushing the installer',
            ], 'switch-to-this-fork.sh');
            assert.match(src, /tar tzf "\$LOCAL_BACKUP_TARBALL"/, 'must verify the laptop copy with tar tzf');
            assert.match(src, /REMOTE_SIZE.*LOCAL_SIZE|LOCAL_SIZE.*REMOTE_SIZE/s, 'must compare pod and laptop backup sizes');
        });
        it('pushes the pre-consent iptables snapshot to the pod rather than trusting a late re-snapshot', () => {
            assert.match(src, /scp_to_pod "\$SSH_PORT" "\$IPTABLES_SNAPSHOT_LOCAL"/);
        });
        it('starts the installer detached (systemd-run, falling back to nohup)', () => {
            assert.match(src, /systemd-run --unit=free-sleep-migrate/);
            assert.match(src, /nohup bash \/home\/dac\/migrate\/pod-installer\.sh/);
        });
        it('the pod-generation gate matrix refuses Pod 1/2 with no override', () => {
            assert.match(src, /Pod 1\/2 have no free-sleep lineage.*no override|fail "Pod 1\/2/);
            assert.doesNotMatch(src.replace(/#.*/g, ''), /pod1\|pod2\)\s*\n\s*:\s*;;/, 'pod1/pod2 must not silently pass through');
        });
        it('requires a typed acknowledgment for Pod 3/4 and for any --assume-model use', () => {
            assert.match(src, /pod4-ok/);
            assert.match(src, /IDENTIFICATION_FAILED/);
        });
    });
    describe('pod-installer.sh ordering', () => {
        const src = readScript('scripts/migrate/pod-installer.sh');
        it('guards entry with a lock file before any other work', () => {
            const lockIdx = src.indexOf('LOCK_FILE');
            const resolveIdx = src.indexOf('Resolving the latest stable release');
            assert.ok(lockIdx !== -1 && lockIdx < resolveIdx, 'lock file check must precede real work');
        });
        it('refuses to run while another fork-update service is active', () => {
            assert.match(src, /free-sleep-update\.service/);
            assert.match(src, /free-sleep-rollback\.service/);
            assert.match(src, /systemctl is-active --quiet/);
        });
        it('verifies artifact hashes and runs the data-compat dry run before the swap', () => {
            assertOrder(src, [
                'Verifying artifact hashes',
                'Data-compatibility dry run',
                'Stopping their service',
            ], 'pod-installer.sh');
        });
        it('copies the restore script outside both trees before the swap', () => {
            assertOrder(src, [
                'cp "$RESTORE_SCRIPT_SRC" "$RESTORE_SCRIPT_DEST"',
                'Stopping their service',
            ], 'pod-installer.sh');
            assert.match(src, /RESTORE_SCRIPT_DEST=\/home\/dac\/restore-original-fork\.sh/);
        });
        it('arms the dead-man sentinel before stopping their service, and only disarms after a passed health check', () => {
            assertOrder(src, [
                'systemctl enable --now "$SENTINEL_TIMER"',
                'Stopping their service',
                'Health check passed',
                'disarm_sentinel',
            ], 'pod-installer.sh');
        });
        it('never executes the staged build pre-swap (syntax check only, port 3000 still belongs to their server)', () => {
            assert.doesNotMatch(src, /node -e "require\(/, 'must not require()/execute the staged server.js before the swap');
            assert.match(src, /node --check "\$STAGE\/server\/dist\/server\.js"/);
        });
        it('applies this fork\'s WAN policy only after the health check succeeds', () => {
            assertOrder(src, [
                'if [ "$HEALTHY" != yes ]',
                'Health check passed',
                'block_internet_access.sh',
            ], 'pod-installer.sh');
        });
        it('never rm -rf\'s /persistent/free-sleep-data or /persistent/free-sleep-backups', () => {
            assert.doesNotMatch(src, /rm[^\n]*\/persistent\/free-sleep-data/);
            assert.doesNotMatch(src, /rm[^\n]*\/persistent\/free-sleep-backups/);
        });
        it('the previous tree lands at the same path update.sh/rollback_pod.sh use for instant rollback', () => {
            assert.match(src, /PREV=\/home\/dac\/free-sleep-prev/);
        });
        // Health check must pass on HTTP 200 + version match. A 200 (not our fast
        // 503-while-connecting) already proves the hub link is up; additionally
        // requiring populated per-side temperatures false-failed a healthy migration
        // because currentTemperatureF reads null for the first cycles after a cold
        // Franken connect. Temperature lag is a logged NOTE, never a failure.
        it('does not hard-fail the health check on a not-yet-populated temperature', () => {
            assert.doesNotMatch(src, /assert isinstance\(d\[side\]\['currentTemperatureF'\]/);
            assert.doesNotMatch(src, /lost temperature reporting/);
            assert.match(src, /not yet reporting a numeric temperature/);
        });
        it('still passes only on HTTP 200 with a matching staged version', () => {
            assertOrder(src, [
                '"$CODE" = 200',
                "d['freeSleep']['version'] == '$STAGED_VERSION'",
            ], 'pod-installer.sh health check');
        });
        // The pod's own updater may already keep a rollback tree at $PREV. Set it
        // aside (never rm -rf) and drop a swap marker so restore keys off "did WE
        // swap", not the bare existence of $PREV.
        it('sets the pod\'s pre-existing rollback slot aside instead of destroying it', () => {
            assert.match(src, /mv "\$PREV" "\$PREEXISTING_PREV"/);
            assert.doesNotMatch(src, /^\s*rm -rf "\$PREV"\s*$/m);
        });
        it('drops the swap marker before mutating $LIVE and clears it on success', () => {
            assertOrder(src, [
                ': > "$SWAP_MARKER"',
                'mv "$LIVE" "$PREV"',
                'mv "$STAGE" "$LIVE"',
                'Health check passed',
                'rm -f "$SWAP_MARKER"',
            ], 'pod-installer.sh swap marker');
        });
        // free-sleep-rollback.service is a static, on-demand oneshot that swaps
        // $LIVE <-> $PREV. `enable --now`-ing it during install executes an instant
        // rollback that transposes the just-installed tree back out before the
        // health check, the exact defect that failed two live migrations. The
        // archive-raw TIMER is periodic and correctly started; the rollback SERVICE
        // must never be started here.
        it('never starts (enable --now) the instant-rollback service during install', () => {
            assert.doesNotMatch(src, /--now\s+free-sleep-rollback\.service/);
            assert.doesNotMatch(src, /systemctl\s+start\s+free-sleep-rollback\.service/);
            // the periodic archive timer is still legitimately started
            assert.match(src, /enable --now free-sleep-archive-raw\.timer/);
        });
        // The swap stops free-sleep-stream (its binary lives in the tree being
        // moved); nothing else restarts it, so the installer must, or live
        // biometrics stay dark until the next reboot.
        it('restarts free-sleep-stream after the swap (it stops it earlier)', () => {
            assertOrder(src, [
                'systemctl stop free-sleep-stream',
                'systemctl start free-sleep',
                'systemctl start free-sleep-stream',
            ], 'pod-installer.sh stream restart');
        });
    });
    describe('restore-original-fork.sh idempotency', () => {
        const src = readScript('scripts/migrate/restore-original-fork.sh');
        it('documents the swap-never/half/already-happened decision table', () => {
            assert.match(src, /never happened, half\s*\n?#?\s*happened, or already happened/);
        });
        it('gates the whole revert on the installer swap marker, not the bare existence of $PREV', () => {
            // Keying off $PREV alone would (a) mistake the pod's own pre-existing
            // rollback slot for the install we swapped out and (b) undo a migration
            // that already succeeded (whose marker is gone). The marker is the signal.
            assertOrder(src, [
                'if [ ! -f "$SWAP_MARKER" ]',
                'systemctl start free-sleep',
            ], 'restore-original-fork.sh');
        });
        it('restores the pod\'s pre-existing rollback slot on both the no-op and revert paths', () => {
            // On revert the stashed slot goes back to $PREV; on the no-op path (died
            // before the swap) it is only put back when $PREV is currently free.
            assert.match(src, /mv "\$PREEXISTING_PREV" "\$PREV"/);
            assert.match(src, /if \[ ! -d "\$PREV" \] && \[ -d "\$PREEXISTING_PREV" \]/);
        });
        it('clears the swap marker on the completed revert path', () => {
            assertOrder(src, [
                'Swap marker present',
                'rm -f "$SWAP_MARKER"',
            ], 'restore-original-fork.sh');
        });
        it('never rm -rf\'s /persistent/free-sleep-data or /persistent/free-sleep-backups', () => {
            assert.doesNotMatch(src, /rm[^\n]*\/persistent\/free-sleep-data/);
            assert.doesNotMatch(src, /rm[^\n]*\/persistent\/free-sleep-backups/);
        });
        it('disarms the sentinel on every exit path', () => {
            const occurrences = src.split('disarm_sentinel').length - 1;
            assert.ok(occurrences >= 2, 'expected disarm_sentinel on both the no-op and restore paths');
        });
    });
    // "Already on this fork" must be decided from the pod's on-disk updater repo,
    // not the HTTP version stream, otherwise a sibling fork that shares the 3.x
    // stream is wrongly refused before SSH even starts. Gate that the decision is
    // deferred and repo-based, so a future edit can't quietly reintroduce the
    // version-only hard stop.
    describe('switch-to-this-fork.sh sibling-fork identification', () => {
        const src = readScript('scripts/migrate/switch-to-this-fork.sh');
        it('does not refuse purely on the version-stream heuristic', () => {
            // The version check may exist as a hint, but must not `fail` on its own.
            assert.doesNotMatch(src, /MAJOR_VERSION[\s\S]{0,240}?-ge 3[\s\S]{0,240}?\bfail /);
        });
        it('reads the pod-side updater and refuses only when it names THIS repo', () => {
            assert.match(src, /THIS_FORK_REPO="LTimothy\/nightstand"/);
            assertOrder(src, [
                '$REMOTE_REPO/scripts/update.sh',
                'ONDISK_FORK_REPO',
                '"$ONDISK_FORK_REPO" = "$THIS_FORK_REPO"',
                'fail ',
            ], 'switch-to-this-fork.sh sibling check');
        });
        it('proceeds when the on-disk updater names a different repo', () => {
            // The non-empty, non-matching branch must be a `say`, not a `fail`.
            assert.match(src, /if \[ -n "\$ONDISK_FORK_REPO" \]; then\s*\n\s*say /);
        });
        // Pod generation must come from the hub's own deviceStatus.coverVersion, not
        // an ls-glob for "capSense2" filenames: those strings are CBOR field names
        // inside <hex>.RAW files, never filenames, so the glob matched nothing on any
        // Pod and forced every real user through --assume-model.
        it('detects pod generation from deviceStatus coverVersion', () => {
            assert.match(src, /COVER_VERSION=.*coverVersion/);
            assert.match(src, /case "\$COVER_VERSION" in/);
        });
    });
});
//# sourceMappingURL=migrationScripts.test.js.map