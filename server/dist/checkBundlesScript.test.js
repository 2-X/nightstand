import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(repoRoot, 'scripts/check-bundles.sh');
function fixture(files) {
    const dir = mkdtempSync(path.join(tmpdir(), 'bundles-'));
    for (const [file, content] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        writeFileSync(path.join(dir, file), content);
    }
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '-A'], { cwd: dir });
    return dir;
}
describe('check-bundles.sh', () => {
    it('passes when every committed chunk and compiled file has a user or a source', () => {
        const dir = fixture({
            'server/public/index.js': 'import("./SleepPage-abc.js")',
            'server/public/SleepPage-abc.js': '',
            'server/public/mockServiceWorker.js': '',
            'server/src/db/prisma.ts': '',
            'server/dist/db/prisma.js': '',
        });
        const run = spawnSync('bash', [SCRIPT, dir], { encoding: 'utf8' });
        assert.equal(run.status, 0, run.stdout);
    });
    it('reports chunks nothing references and compiled files whose source is gone', () => {
        const dir = fixture({
            'server/public/index.js': 'import("./SleepPage-new.js")',
            'server/public/SleepPage-new.js': '',
            'server/public/SleepPage-old.js': '',
            'server/public/SleepPage-old.js.map': '',
            'server/dist/db/loadMovementRecords.js': '',
        });
        const run = spawnSync('bash', [SCRIPT, dir], { encoding: 'utf8' });
        assert.equal(run.status, 1);
        assert.match(run.stdout, /orphan: server\/public\/SleepPage-old\.js/);
        assert.match(run.stdout, /orphan: server\/dist\/db\/loadMovementRecords\.js/);
        assert.doesNotMatch(run.stdout, /SleepPage-new/);
    });
});
//# sourceMappingURL=checkBundlesScript.test.js.map