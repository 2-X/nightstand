import assert from 'node:assert/strict';
import { test } from 'node:test';
import moment from 'moment-timezone';
import { sleepAnalysisWindow } from './sleepAnalysisWindow.js';
test('noon analysis includes the preceding evening', () => {
    const window = sleepAnalysisWindow(moment.tz('2026-09-11T12:00:00', 'America/New_York'));
    assert.equal(window.startTime, '2026-09-10T16:00:00.000Z');
    assert.equal(window.endTime, '2026-09-11T16:00:00.000Z');
});
test('calendar-day window remains noon-to-noon through DST', () => {
    for (const [date, hours] of [['2026-03-08', 23], ['2026-11-01', 25]]) {
        const now = moment.tz(`${date}T12:00:00`, 'America/New_York');
        const window = sleepAnalysisWindow(now);
        assert.equal(moment(window.endTime).diff(moment(window.startTime), 'hours'), hours);
        assert.equal(moment(window.startTime).tz('America/New_York').hour(), 12);
    }
});
//# sourceMappingURL=sleepAnalysisWindow.test.js.map