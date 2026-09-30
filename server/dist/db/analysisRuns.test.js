import { after, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-runs-'));
const server = path.resolve(import.meta.dirname, '../..');
fs.mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';
process.env.DATABASE_URL = `file:${folder}/runs.db`;
execFileSync(process.execPath, [
    path.join(server, 'node_modules/prisma/build/index.js'),
    'migrate', 'deploy', '--schema', path.join(server, 'prisma/schema.prisma'),
], { env: process.env, stdio: 'pipe', timeout: 60_000 });
const { prisma } = await import('./prisma.js');
after(async () => {
    await prisma.$disconnect();
    fs.rmSync(folder, { recursive: true, force: true });
});
it('reads a run the analyzer wrote through the Prisma model', async () => {
    await prisma.$executeRaw `INSERT INTO analysis_runs
    (side, kind, started_at, window_start, window_end, status, rows_loaded, peak_rss_mb, code_version)
    VALUES ('left', 'analyze', 1790600000, 1790550000, 1790640000, 'ok', 88000, 512.5, '3.4.0')`;
    const run = await prisma.analysis_runs.findFirst({ where: { side: 'left' } });
    assert.ok(run);
    assert.equal(run.status, 'ok');
    assert.equal(run.rows_loaded, 88000);
    assert.equal(run.peak_rss_mb, 512.5);
    assert.equal(run.finished_at, null);
    assert.equal(run.error, null);
});
//# sourceMappingURL=analysisRuns.test.js.map