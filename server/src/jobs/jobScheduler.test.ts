import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isScheduleDbChange } from './isScheduleDbChange.js';

describe('scheduler file allowlist', () => {
  it('accepts only settings, schedule and Rhythms writes and their atomic temporary files', () => {
    const watched = [
      'settingsDB.json', 'schedulesDB.json', 'rhythmsDB.json',
      '.settingsDB.json.tmp', '.schedulesDB.json.tmp', '.rhythmsDB.json.tmp',
    ];
    for (const name of watched) {
      assert.equal(isScheduleDbChange(name), true, name);
    }
    const ignored = ['servicesDB.json', '.servicesDB.json.tmp', 'settingsDB.json.bak', '.rhythmsDB.json.bak', 'rhythms-history.jsonl'];
    for (const name of ignored) {
      assert.equal(isScheduleDbChange(name), false, name);
    }
  });
});
