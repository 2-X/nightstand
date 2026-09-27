import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dataFolder = mkdtempSync(path.join(tmpdir(), 'nightstand-raw-archive-conf-'));
process.env.DATA_FOLDER = `${dataFolder}/`;
process.env.ENV = 'local';

const { rawArchiveConfPath, writeRawArchiveConf } = await import('./rawArchiveConf.js');

describe('writeRawArchiveConf', () => {
  it('writes the retention in hours next to the data', async () => {
    await writeRawArchiveConf(14);
    assert.equal(rawArchiveConfPath(), `${dataFolder}/raw-archive.conf`);
    assert.equal(readFileSync(rawArchiveConfPath(), 'utf8'), 'RETENTION_HOURS=336\n');
  });

  it('replaces the file without leaving the temp copy behind', async () => {
    const confPath = path.join(dataFolder, 'other.conf');
    await writeRawArchiveConf(2, confPath);
    await writeRawArchiveConf(60, confPath);
    assert.equal(readFileSync(confPath, 'utf8'), 'RETENTION_HOURS=1440\n');
    assert.equal(existsSync(`${confPath}.tmp`), false);
  });
});
