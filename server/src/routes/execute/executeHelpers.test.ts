import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExecuteArg } from './executeHelpers.js';

describe('normalizeExecuteArg', () => {
  it('passes a string through for a command with no declared bounds', () => {
    assert.equal(normalizeExecuteArg('PRIME', 'anything'), 'anything');
  });

  it('sends the placeholder when an unbounded command has no arg', () => {
    assert.equal(normalizeExecuteArg('PRIME', undefined), 'empty');
    assert.equal(normalizeExecuteArg('PRIME', ''), 'empty');
  });

  it('refuses a non-string arg for an unbounded command', () => {
    assert.equal(normalizeExecuteArg('SET_SETTINGS', 5), undefined);
    assert.equal(normalizeExecuteArg('SET_SETTINGS', { evil: 1 }), undefined);
  });

  it('accepts a temperature level within -100..100', () => {
    assert.equal(normalizeExecuteArg('TEMP_LEVEL_LEFT', '0'), '0');
    assert.equal(normalizeExecuteArg('TEMP_LEVEL_RIGHT', '-100'), '-100');
    assert.equal(normalizeExecuteArg('TEMP_LEVEL_RIGHT', 100), '100');
  });

  it('rejects a temperature level outside -100..100', () => {
    assert.equal(normalizeExecuteArg('TEMP_LEVEL_LEFT', '101'), undefined);
    assert.equal(normalizeExecuteArg('TEMP_LEVEL_LEFT', '-101'), undefined);
  });

  it('rejects anything but a plain whole number for a bounded command', () => {
    for (const arg of ['not-a-number', '1e2', '0x10', ' 50 ', '10.5', '', undefined, true, [5]]) {
      assert.equal(normalizeExecuteArg('TEMP_LEVEL_LEFT', arg), undefined, JSON.stringify(arg));
    }
  });

  it('accepts a duration within 0..43200 seconds', () => {
    assert.equal(normalizeExecuteArg('LEFT_TEMP_DURATION', '43200'), '43200');
    assert.equal(normalizeExecuteArg('RIGHT_TEMP_DURATION', '0'), '0');
  });

  it('rejects a duration above the 12-hour cap', () => {
    assert.equal(normalizeExecuteArg('LEFT_TEMP_DURATION', '43201'), undefined);
  });
});
