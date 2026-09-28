import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Low } from 'lowdb';
import { createSerializedUpdate } from './serializedUpdate.js';

for (const callback of ['mutation', 'afterWrite'] as const) {
  test(`rejects a database read from its own ${callback} callback`, async () => {
    const db = new Low({ read: async () => null, write: async () => undefined }, { value: 0 });
    const update = createSerializedUpdate(db);
    const saving = callback === 'mutation'
      ? update(() => { void db.read(); })
      : update(draft => { draft.value = 1; }, async () => { await db.read(); });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await assert.rejects(Promise.race([
        saving,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Database callback did not settle')), 250); }),
      ]), /Cannot read this database inside its serialized update callback/);
    } finally {
      clearTimeout(timer);
    }
    await update(draft => { draft.value = 2; });
    assert.equal(db.data.value, 2);
  });
}

test('a read started before a save cannot restore stale in-memory settings', async () => {
  let stored = { enabled: false };
  let releaseRead!: () => void;
  let readStarted!: () => void;
  const started = new Promise<void>(resolve => { readStarted = resolve; });
  const blocked = new Promise<void>(resolve => { releaseRead = resolve; });
  let reads = 0;
  const db = new Low({
    read: async () => {
      const snapshot = structuredClone(stored);
      if (++reads === 1) { readStarted(); await blocked; }
      return snapshot;
    },
    write: async (data: typeof stored) => { stored = structuredClone(data); },
  }, stored);
  const update = createSerializedUpdate(db);
  const reading = db.read();
  await started;
  const saving = update(draft => { draft.enabled = true; });
  await new Promise(resolve => setImmediate(resolve));
  releaseRead();
  await Promise.all([reading, saving]);
  assert.equal(stored.enabled, true);
  assert.equal(db.data.enabled, true);
});

test('a failed write does not prevent a later save', async () => {
  let fail = true;
  const db = new Low({
    read: async () => null,
    write: async () => { if (fail) throw new Error('write failed'); },
  }, { value: 0 });
  const update = createSerializedUpdate(db);
  await assert.rejects(update(draft => { draft.value = 1; }), /write failed/);
  fail = false;
  await update(draft => { draft.value = 2; });
  assert.equal(db.data.value, 2);
});

test('derived settings writes finish in save order before the next transaction', async () => {
  let stored = { retentionDays: 7 };
  const db = new Low({
    read: async () => structuredClone(stored),
    write: async (data: typeof stored) => { stored = structuredClone(data); },
  }, stored);
  const update = createSerializedUpdate(db);
  let releaseFirst!: () => void;
  let firstStarted!: () => void;
  const started = new Promise<void>(resolve => { firstStarted = resolve; });
  const blocked = new Promise<void>(resolve => { releaseFirst = resolve; });
  let archiveRetention = 7;
  const first = update(draft => { draft.retentionDays = 14; }, async draft => {
    firstStarted();
    await blocked;
    archiveRetention = draft.retentionDays;
  });
  await started;
  const reading = db.read();
  const second = update(draft => { draft.retentionDays = 30; }, async draft => {
    archiveRetention = draft.retentionDays;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stored.retentionDays, 14);
  releaseFirst();
  await Promise.all([first, reading, second]);
  assert.equal(archiveRetention, stored.retentionDays);
  assert.equal(archiveRetention, 30);
});
