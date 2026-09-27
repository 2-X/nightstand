import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIRM_READINGS,
  WaterLevelEvent,
  WaterLevelStore,
  WaterLevelTracker,
  WaterTankState,
} from './waterLevelTracker.js';

class MemoryStore implements WaterLevelStore {
  public events: WaterLevelEvent[] = [];
  public failAppend = false;

  constructor(initial: WaterLevelEvent[] = []) {
    this.events = [...initial];
  }

  async latest() {
    return this.events.at(-1) ?? null;
  }

  async append(event: WaterLevelEvent) {
    if (this.failAppend) throw new Error('database is locked');
    this.events.push(event);
  }
}

async function setup(initial: WaterLevelEvent[] = []) {
  const store = new MemoryStore(initial);
  const changes: WaterTankState[] = [];
  const tracker = new WaterLevelTracker(store, (state) => changes.push(state));
  await tracker.init();
  return { store, changes, tracker };
}

// Feeds `count` readings one second apart starting at `start`, then lets the
// fire-and-forget store write settle.
async function feed(tracker: WaterLevelTracker, raw: string, count: number, start: number) {
  for (let i = 0; i < count; i++) tracker.observe(raw, start + i);
  await new Promise((resolve) => setImmediate(resolve));
}

describe('WaterLevelTracker', () => {
  it('records the first confirmed reading on a fresh install', async () => {
    const { store, changes, tracker } = await setup();
    await feed(tracker, 'true', CONFIRM_READINGS, 100);

    assert.deepEqual(store.events, [{ level: 'ok', timestamp: 100 }]);
    assert.deepEqual(changes, [{ level: 'ok', since: 100 }]);
    assert.deepEqual(tracker.state, { level: 'ok', since: 100 });
  });

  it('has no state until a reading is confirmed', async () => {
    const { store, tracker } = await setup();
    await feed(tracker, 'false', CONFIRM_READINGS - 1, 100);

    assert.equal(tracker.state, undefined);
    assert.deepEqual(store.events, []);
  });

  it('dates a low tank from the first low reading, not from confirmation', async () => {
    const { store, tracker } = await setup([{ level: 'ok', timestamp: 1 }]);
    await feed(tracker, 'false', CONFIRM_READINGS, 500);

    assert.deepEqual(store.events.at(-1), { level: 'low', timestamp: 500 });
    assert.deepEqual(tracker.state, { level: 'low', since: 500 });
  });

  it('ignores a flicker shorter than the confirmation window', async () => {
    const { store, changes, tracker } = await setup([{ level: 'ok', timestamp: 1 }]);
    await feed(tracker, 'false', CONFIRM_READINGS - 1, 500);
    await feed(tracker, 'true', 1, 600);
    await feed(tracker, 'false', CONFIRM_READINGS - 1, 700);

    assert.equal(store.events.length, 1);
    assert.deepEqual(changes, []);
    assert.deepEqual(tracker.state, { level: 'ok', since: 1 });
  });

  it('keeps the stored date across a restart instead of writing a duplicate', async () => {
    const { store, changes, tracker } = await setup([{ level: 'low', timestamp: 42 }]);
    await feed(tracker, 'false', CONFIRM_READINGS * 3, 1000);

    assert.equal(store.events.length, 1);
    assert.deepEqual(changes, []);
    assert.deepEqual(tracker.state, { level: 'low', since: 42 });
  });

  it('records a refill after a low tank', async () => {
    const { store, tracker } = await setup([{ level: 'low', timestamp: 42 }]);
    await feed(tracker, 'true', CONFIRM_READINGS, 2000);

    assert.deepEqual(store.events.at(-1), { level: 'ok', timestamp: 2000 });
    assert.deepEqual(tracker.state, { level: 'ok', since: 2000 });
  });

  it('skips values the hardware is not known to send', async () => {
    const { store, tracker } = await setup([{ level: 'ok', timestamp: 1 }]);
    await feed(tracker, 'unknown', CONFIRM_READINGS * 2, 100);

    assert.equal(store.events.length, 1);
    assert.deepEqual(tracker.state, { level: 'ok', since: 1 });
  });

  it('keeps tracking in memory when the store write fails', async () => {
    const { store, changes, tracker } = await setup([{ level: 'ok', timestamp: 1 }]);
    store.failAppend = true;
    await feed(tracker, 'false', CONFIRM_READINGS, 500);

    assert.deepEqual(tracker.state, { level: 'low', since: 500 });
    assert.deepEqual(changes, [{ level: 'low', since: 500 }]);
  });

  it('starts empty when the store cannot be read', async () => {
    const store = new MemoryStore();
    store.latest = async () => { throw new Error('no such table'); };
    const tracker = new WaterLevelTracker(store, () => {});
    await tracker.init();
    await feed(tracker, 'true', CONFIRM_READINGS, 100);

    assert.deepEqual(tracker.state, { level: 'ok', since: 100 });
  });
});
