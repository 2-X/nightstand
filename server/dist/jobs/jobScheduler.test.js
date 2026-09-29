import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isScheduleDbChange } from './isScheduleDbChange.js';
describe('scheduler file allowlist', () => {
    it('accepts only schedule/settings writes and their atomic temporary files', () => {
        for (const name of ['settingsDB.json', 'schedulesDB.json', '.settingsDB.json.tmp', '.schedulesDB.json.tmp']) {
            assert.equal(isScheduleDbChange(name), true, name);
        }
        for (const name of ['servicesDB.json', '.servicesDB.json.tmp', 'rhythmsDB.json', '.rhythmsDB.json.tmp', 'settingsDB.json.bak']) {
            assert.equal(isScheduleDbChange(name), false, name);
        }
    });
});
//# sourceMappingURL=jobScheduler.test.js.map