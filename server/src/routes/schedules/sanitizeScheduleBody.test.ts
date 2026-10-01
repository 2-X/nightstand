import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeScheduleBody } from './sanitizeScheduleBody.js';

describe('sanitizeScheduleBody', () => {
  it('drops stale unknown day-level keys like a leftover elevations field', () => {
    const result = sanitizeScheduleBody({
      left: {
        monday: { power: { enabled: true }, elevations: { head: 10 } },
      },
    });
    assert.deepEqual(result, {
      left: {
        monday: { power: { enabled: true } },
      },
    });
  });

  it('keeps every known day-level field, including the multi-alarm alarms array', () => {
    const daySchedule = {
      temperatures: { '22:00': 70 },
      power: { on: '22:00', off: '07:00', onTemperature: 70, enabled: true },
      alarm: { time: '07:00', enabled: true },
      alarms: [{ time: '07:00', enabled: true }],
    };
    const result = sanitizeScheduleBody({ right: { sunday: daySchedule } });
    assert.deepEqual(result.right.sunday, daySchedule);
  });

  it('handles a missing or empty body without throwing', () => {
    assert.deepEqual(sanitizeScheduleBody(undefined), {});
    assert.deepEqual(sanitizeScheduleBody({}), {});
  });
});

describe('sanitizeScheduleBody with wrong types', () => {
  it('passes a side or day that is not an object through for the schema to refuse', () => {
    assert.deepEqual(sanitizeScheduleBody({ left: 5 }), { left: 5 });
    assert.deepEqual(sanitizeScheduleBody({ left: { monday: 'garbage' } }), { left: { monday: 'garbage' } });
    assert.deepEqual(sanitizeScheduleBody({ right: { sunday: [1] } }), { right: { sunday: [1] } });
  });

  it('still treats a null side or day as an empty update', () => {
    assert.deepEqual(sanitizeScheduleBody({ left: null }), { left: {} });
    assert.deepEqual(sanitizeScheduleBody({ left: { monday: null } }), { left: { monday: {} } });
  });
});
