import assert from 'node:assert/strict';
import { after, before, it, mock } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-leave-hook-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';

const handoffs: string[] = [];
mock.module(new URL('../jobs/rhythms/handoff.js', import.meta.url).href, { namedExports: {
  prepareToLeaveRhythms: async (reason: string) => {
    handoffs.push(reason);
    return { sides: [] };
  },
  disableRhythms: async () => ({ sides: [] }),
} });

let server: Server;
let url: string;
before(async () => {
  const app = express();
  app.use(express.json());
  (await import('./routes.js')).default(app);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); });
  rmSync(folder, { recursive: true, force: true });
});

it('the mounted routes hand Rhythms sleeps back when a script prepares to stop', async () => {
  const response = await fetch(`${url}/api/update/prepare-to-stop`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'revert' }),
  });
  assert.equal(response.status, 204);
  assert.deepEqual(handoffs, ['revert']);
});

// A rollback, a downgrade or a switch leaves for a version that keeps no
// alarm record, so the alarms saved here would read as missed on the way back.
const ledgerFile = path.join(folder, 'alarm-ledger.json');
const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);
for (const body of [
  { reason: 'rollback' }, { reason: 'downgrade' }, { reason: 'revert' },
  { reason: 'rollback', handBack: false }, { reason: 'downgrade', handBack: false },
]) {
  it(`forgets the saved alarms before stopping for ${JSON.stringify(body)}`, async () => {
    const ledger = await import('../jobs/alarmLedger.js');
    ledger.resetAlarmLedgerForTests();
    writeFileSync(ledgerFile, JSON.stringify({
      version: 1, aliveAt: new Date().toISOString(), started: [], missed: [],
      upcoming: [{ side: 'left', at: later(5).toISOString(), jobName: 'left-one-off-alarm' }],
    }));
    ledger.startAlarmLedger(new Date());
    handoffs.length = 0;
    const response = await fetch(`${url}/api/update/prepare-to-stop`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(response.status, 204);
    assert.deepEqual(JSON.parse(readFileSync(ledgerFile, 'utf8')).upcoming, []);
    // The target continues Rhythms sleeps itself when told not to hand them back.
    assert.deepEqual(handoffs, body.handBack === false ? [] : [body.reason]);
    ledger.resetAlarmLedgerForTests();
    assert.deepEqual(ledger.startAlarmLedger(later(60)), []);
    ledger.resetAlarmLedgerForTests();
  });
}
