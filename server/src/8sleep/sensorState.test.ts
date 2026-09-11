import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SensorState, SensorSampleSchema } from './sensorState.js';
import { temperatureSourceFresh } from './temperatureFreshness.js';

test('reject stale, replayed, future and malformed sensor samples', () => {
  const state = new SensorState();
  assert.equal(state.accept({ kind: 'frzTemp', at: 100, fields: { ambC: 22 } }, 101), true);
  assert.equal(state.accept({ kind: 'frzTemp', at: 100, fields: { ambC: 99 } }, 102), false);
  assert.equal(state.accept({ kind: 'frzTemp', at: 105, fields: {} }, 104), false);
  assert.equal(state.accept({ kind: 'bedTemp', at: 50, fields: {} }, 100), false);
  assert.equal(state.snapshot(131).find(row => row.kind === 'frzTemp')?.state, 'stale');
  assert.equal(SensorSampleSchema.safeParse({ kind: 'frzTemp', at: 100, fields: { ambC: Infinity } }).success, false);
});

test('automatic readiness requires fresh connected cover, valid thermal controller and all surface channels', () => {
  const state = new SensorState();
  state.accept({ kind: 'sensHealth', at: 100, fields: { 'left.connected': true } }, 100);
  state.accept({ kind: 'frzTherm', at: 100, fields: { 'left.valid': true, 'left.enabled': true } }, 100);
  assert.equal(state.ready('left', 100), false);
  state.accept({ kind: 'bedTemp', at: 100, fields: { 'left.sideC': 22, 'left.outC': 22, 'left.cenC': 22, 'left.inC': 22 } }, 100);
  assert.equal(state.ready('left', 100), true);
  assert.equal(state.ready('right', 100), false);
  assert.equal(state.ready('left', 131), false);
  state.accept({ kind: 'sensHealth', at: 101, fields: { 'left.connected': false } }, 101);
  assert.equal(state.ready('left', 101), false);
});

test('old or future temperatures cannot be stamped into fresh history', () => {
  assert.equal(temperatureSourceFresh(new Date(100000).toISOString(), 110000), true);
  assert.equal(temperatureSourceFresh(new Date(100000).toISOString(), 200001), false);
  assert.equal(temperatureSourceFresh(new Date(100000).toISOString(), 99999), false);
  assert.equal(temperatureSourceFresh(null), false);
});
