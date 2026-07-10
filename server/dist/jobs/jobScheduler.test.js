import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isServicesDbChange } from './isServicesDbChange.js';
describe('isServicesDbChange', () => {
    // Regression test for a real production incident: lowdb's steno writer
    // writes servicesDB.json via a temp file (.servicesDB.json.tmp) then
    // renames it. Job-status writes (biometrics health pings, serverStatus
    // polling) fire far more often than schedule/settings changes, and each
    // unmatched temp-file event triggered a full job cancel-and-reschedule,
    // which under a polling client became a self-sustaining feedback loop
    // that blocked the event loop long enough to fail deploy health checks
    // three times in a row.
    it('matches the final atomic-rename target', () => {
        assert.equal(isServicesDbChange('servicesDB.json'), true);
    });
    it('matches the steno temp file written before the rename', () => {
        assert.equal(isServicesDbChange('.servicesDB.json.tmp'), true);
    });
    it('does not match other lowdb files, so they still trigger a reschedule', () => {
        assert.equal(isServicesDbChange('schedulesDB.json'), false);
        assert.equal(isServicesDbChange('settingsDB.json'), false);
        assert.equal(isServicesDbChange('.schedulesDB.json.tmp'), false);
    });
});
//# sourceMappingURL=jobScheduler.test.js.map