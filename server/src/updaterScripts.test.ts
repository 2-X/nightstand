import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The pod's self-updater is bash, so it can't be unit-tested here, but a
// syntax error or a wrong URL would brick the update path. Gate the cheap,
// high-signal invariants: the scripts parse, they point at this fork, and
// the safety rails (rollback, WAN re-block) are present.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPTS = [
  'scripts/update.sh',
  'scripts/update_service.sh',
  'scripts/install.sh',
  'scripts/enable_biometrics.sh',
  'scripts/disable_biometrics.sh',
  'ops/deploy.sh',
  'ops/rollback.sh',
];

describe('updater shell scripts', () => {
  for (const script of SCRIPTS) {
    it(`${script} exists and parses (bash -n)`, () => {
      const full = path.join(repoRoot, script);
      assert.equal(existsSync(full), true, `${script} is missing`);
      assert.doesNotThrow(() => execFileSync('bash', ['-n', full]));
    });
  }

  it('update.sh pulls from this fork by default, overridable via env', () => {
    const src = readFileSync(path.join(repoRoot, 'scripts/update.sh'), 'utf8');
    assert.match(src, /NIGHTSTAND_REPO:-LTimothy\/nightstand/, 'must default to this fork');
    assert.match(src, /NIGHTSTAND_BRANCH:-main/, 'must default to main');
    assert.match(src, /ZIP_URL="https:\/\/github\.com\/\$\{NIGHTSTAND_REPO\}\/archive\/refs\/heads\/\$\{NIGHTSTAND_BRANCH\}\.zip"/);
    assert.match(
      src,
      /INFO_URL="https:\/\/raw\.githubusercontent\.com\/\$\{NIGHTSTAND_REPO\}\/\$\{NIGHTSTAND_BRANCH\}\/server\/src\/serverInfo\.json"/
    );
    assert.match(src, /block_internet_access\.sh/, 'must re-block WAN');
    assert.match(src, /trap cleanup EXIT/, 'must re-block WAN even on failure');
    assert.match(src, /rolling back/i, 'must have a rollback path');
    assert.match(src, /server\/dist\/server\.js/, 'must verify the staged build output');
    // The archive's top dir is named after the repo, so it must be resolved
    // dynamically, never hardcoded to a repo name that a rename would break.
    assert.doesNotMatch(src, /free-sleep-main|nightstand-main/, 'must not hardcode the archive dir name');
    assert.match(src, /find "\$STAGE\.unzip".*-type d/, 'must resolve the staged archive dir dynamically');
  });

  // free-sleep-update.service ExecStarts update_service.sh, which runs
  // update.sh. If either loses its exec bit the unit dies with 203/EXEC
  // before writing a single log line.
  for (const script of SCRIPTS) {
    it(`${script} is executable`, () => {
      const mode = statSync(path.join(repoRoot, script)).mode;
      assert.ok(mode & 0o111, `${script} must carry the exec bit`);
    });
  }

  it('the update unit runs the script via bash (immune to lost exec bits)', () => {
    const src = readFileSync(path.join(repoRoot, 'scripts/install.sh'), 'utf8');
    assert.match(src, /ExecStart=\/bin\/bash \/home\/dac\/free-sleep\/scripts\/update_service\.sh/);
  });

  it('install.sh installs from this fork', () => {
    const src = readFileSync(path.join(repoRoot, 'scripts/install.sh'), 'utf8');
    assert.match(src, /github\.com\/LTimothy\/nightstand\/archive\/refs\/heads\/main\.zip/);
  });

  // Regression coverage: disable_biometrics.sh existed but was never granted
  // a sudoers rule or invoked, so flipping the Settings biometrics toggle off
  // never stopped free-sleep-stream.service. Gate both halves of the fix:
  // fresh installs get the rule, and existing pods self-heal it on their
  // next update (mirroring the instant-rollback sudoers self-heal below).
  it('install.sh grants a NOPASSWD sudoers rule for disable_biometrics.sh', () => {
    const src = readFileSync(path.join(repoRoot, 'scripts/install.sh'), 'utf8');
    assert.match(
      src,
      /ALL=\(ALL\) NOPASSWD: \/bin\/sh \/home\/dac\/free-sleep\/scripts\/disable_biometrics\.sh/
    );
  });

  it('update.sh self-heals the disable_biometrics.sh sudoers rule on existing pods', () => {
    const src = readFileSync(path.join(repoRoot, 'scripts/update.sh'), 'utf8');
    assert.match(
      src,
      /ALL=\(ALL\) NOPASSWD: \/bin\/sh \/home\/dac\/free-sleep\/scripts\/disable_biometrics\.sh/
    );
  });

  it('disable_biometrics.sh actually stops and disables the stream service', () => {
    const src = readFileSync(path.join(repoRoot, 'scripts/disable_biometrics.sh'), 'utf8');
    assert.match(src, /systemctl stop free-sleep-stream/);
    assert.match(src, /systemctl disable free-sleep-stream/);
  });

  // Target-version protocol: the server writes update-target.json before
  // starting the service; a syntax slip here would either silently ignore a
  // requested version+downgrade (surprising) or brick every plain update
  // (catastrophic), so gate both the presence and the ordering of the safety
  // checks.
  describe('update.sh target-version protocol', () => {
    const src = readFileSync(path.join(repoRoot, 'scripts/update.sh'), 'utf8');

    it('reads and consumes update-target.json exactly once', () => {
      assert.match(src, /TARGET_FILE=\/persistent\/free-sleep-data\/update-target\.json/);
      assert.match(src, /rm -f "\$TARGET_FILE"/, 'must delete the target file so it cannot redirect a future plain update');
      // Consume-once ordering: the file is read into a variable before it's
      // removed, and removed before the requested version is ever acted on.
      const readIdx = src.indexOf('TARGET_JSON=$(cat "$TARGET_FILE")');
      const rmIdx = src.indexOf('rm -f "$TARGET_FILE"');
      const useIdx = src.indexOf('TARGET_VERSION=$(printf');
      assert.ok(readIdx > -1 && rmIdx > -1 && useIdx > -1, 'expected read -> consume -> use sequence to be present');
      assert.ok(readIdx < rmIdx && rmIdx < useIdx, 'must delete the target file before using its contents');
    });

    it('has a floor version below which targeted installs are refused', () => {
      assert.match(src, /FLOOR_VERSION="\d+\.\d+\.\d+"/);
      assert.match(src, /is below the floor/);
    });

    it('refuses a downgrade unless allowDowngrade was requested', () => {
      assert.match(src, /ALLOW_DOWNGRADE/);
      assert.match(src, /IS_DOWNGRADE/);
      assert.match(src, /is older than the running.*refusing without allowDowngrade/);
    });

    it('skips prisma migrate on a downgrade', () => {
      assert.match(src, /IS_DOWNGRADE.*=.*yes.*\n.*skipping prisma migrate/);
    });

    it('resolves a tagged release via the GitHub tag-archive URL, not just the branch zip', () => {
      assert.match(src, /TAG_ZIP_URL_PREFIX="https:\/\/github\.com\/\$\{NIGHTSTAND_REPO\}\/archive\/refs\/tags\/v"/);
    });

    it('verifies releases.json before installing a requested version', () => {
      assert.match(src, /RELEASES_URL="https:\/\/raw\.githubusercontent\.com\/\$\{NIGHTSTAND_REPO\}\/\$\{NIGHTSTAND_BRANCH\}\/releases\.json"/);
      assert.match(src, /is not a known release/);
    });

    it('refuses a staged tree whose version does not match what was requested', () => {
      assert.match(src, /staged tree reports v\$STAGED_VERSION but v\$TARGET_VERSION was requested/);
    });
  });
});
