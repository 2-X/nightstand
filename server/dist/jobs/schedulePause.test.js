import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describePause, isAlarmPaused, isSchedulePaused, pauseEndsAt } from './schedulePause.js';
const NOW = new Date('2026-09-28T20:00:00Z');
const inactive = { active: false, expiresAt: '' };
function settingsWith(left, right = inactive) {
    return {
        left: { scheduleOverrides: { pause: left } },
        right: { scheduleOverrides: { pause: right } },
    };
}
describe('isSchedulePaused', () => {
    it('is false for an inactive pause', () => {
        assert.equal(isSchedulePaused(settingsWith(inactive), 'left', NOW), false);
    });
    it('is true for an active pause with no end', () => {
        const settings = settingsWith({ active: true, expiresAt: '' });
        assert.equal(isSchedulePaused(settings, 'left', NOW), true);
        assert.equal(isSchedulePaused(settings, 'left', new Date('2027-01-01T00:00:00Z')), true);
    });
    it('is true before a future end and false from the end on', () => {
        const settings = settingsWith({ active: true, expiresAt: '2026-09-29T07:00:00-00:00' });
        assert.equal(isSchedulePaused(settings, 'left', NOW), true);
        assert.equal(isSchedulePaused(settings, 'left', new Date('2026-09-29T06:59:59Z')), true);
        assert.equal(isSchedulePaused(settings, 'left', new Date('2026-09-29T07:00:00Z')), false);
        assert.equal(isSchedulePaused(settings, 'left', new Date('2026-09-29T08:00:00Z')), false);
    });
    it('treats an unreadable end as not paused', () => {
        assert.equal(isSchedulePaused(settingsWith({ active: true, expiresAt: 'soon' }), 'left', NOW), false);
    });
    it('treats settings saved before pause existed as not paused', () => {
        const settings = { left: { scheduleOverrides: {} }, right: {} };
        assert.equal(isSchedulePaused(settings, 'left', NOW), false);
        assert.equal(isSchedulePaused(settings, 'right', NOW), false);
    });
    it('leaves the partner side unpaused', () => {
        const settings = settingsWith({ active: true, expiresAt: '' });
        assert.equal(isSchedulePaused(settings, 'right', NOW), false);
    });
});
describe('isAlarmPaused', () => {
    const timed = settingsWith({ active: true, expiresAt: '2026-09-29T07:00:00Z' });
    it('covers an alarm due exactly at the end of the pause', () => {
        assert.equal(isAlarmPaused(timed, 'left', new Date('2026-09-29T06:59:59Z')), true);
        assert.equal(isAlarmPaused(timed, 'left', new Date('2026-09-29T07:00:00Z')), true);
        assert.equal(isSchedulePaused(timed, 'left', new Date('2026-09-29T07:00:00Z')), false);
    });
    it('lets an alarm due after the end ring', () => {
        assert.equal(isAlarmPaused(timed, 'left', new Date('2026-09-29T07:00:01Z')), false);
    });
    it('reads open-ended, inactive, unreadable and partner pauses like isSchedulePaused', () => {
        assert.equal(isAlarmPaused(settingsWith({ active: true, expiresAt: '' }), 'left', NOW), true);
        assert.equal(isAlarmPaused(settingsWith(inactive), 'left', NOW), false);
        assert.equal(isAlarmPaused(settingsWith({ active: true, expiresAt: 'soon' }), 'left', NOW), false);
        assert.equal(isAlarmPaused(timed, 'right', NOW), false);
        const old = { left: { scheduleOverrides: {} }, right: {} };
        assert.equal(isAlarmPaused(old, 'left', NOW), false);
    });
});
describe('pauseEndsAt', () => {
    it('returns the end of a timed pause', () => {
        const settings = settingsWith({ active: true, expiresAt: '2026-09-29T00:00:00-07:00' });
        assert.equal(pauseEndsAt(settings, 'left')?.toISOString(), '2026-09-29T07:00:00.000Z');
    });
    it('returns null for an open-ended or inactive pause', () => {
        assert.equal(pauseEndsAt(settingsWith({ active: true, expiresAt: '' }), 'left'), null);
        assert.equal(pauseEndsAt(settingsWith({ active: false, expiresAt: '2026-09-29T07:00:00Z' }), 'left'), null);
    });
});
describe('describePause', () => {
    it('names the end time or says it waits for a resume', () => {
        assert.equal(describePause(settingsWith({ active: true, expiresAt: '2026-09-29T07:00:00Z' }), 'left'), 'until 2026-09-29T07:00:00.000Z');
        assert.equal(describePause(settingsWith({ active: true, expiresAt: '' }), 'left'), 'until resumed');
    });
});
//# sourceMappingURL=schedulePause.test.js.map