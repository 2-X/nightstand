import { describe, expect, it } from 'vitest';
import { scheduleIsValid, validateSchedule } from './scheduleValidation';
import { getSchedules } from '../../mocks/mockData';
import type { DailySchedule } from '@api/schedulesSchema';

function day(power: Partial<DailySchedule['power']>, alarms: Array<{ time: string; enabled?: boolean }>): DailySchedule {
  const base = structuredClone(getSchedules().left.monday);
  return {
    ...base,
    power: { ...base.power, enabled: true, on: '21:00', off: '07:00', ...power },
    temperatures: {},
    alarm: { ...base.alarm, enabled: true, time: alarms[0].time },
    alarms: alarms.map(value => ({ ...base.alarm, enabled: value.enabled ?? true, time: value.time })),
  };
}

describe('alarm times against the power window', () => {
  it('accepts alarms from bedtime through the turn-off minute', () => {
    expect(scheduleIsValid(day({}, [{ time: '21:00' }, { time: '07:00' }]))).toBe(true);
  });

  it('rejects an enabled alarm one minute after turn-off', () => {
    expect(validateSchedule(day({}, [{ time: '06:30' }, { time: '07:01' }])).invalidTimes).toBe(1);
  });

  it('accepts a later alarm once turn-off is at or after it', () => {
    expect(scheduleIsValid(day({ off: '07:30' }, [{ time: '07:00' }, { time: '07:30' }]))).toBe(true);
  });

  it('ignores disabled alarms outside the window', () => {
    expect(scheduleIsValid(day({}, [{ time: '06:30' }, { time: '12:00', enabled: false }]))).toBe(true);
  });

  it('counts each enabled alarm outside the window', () => {
    expect(validateSchedule(day({}, [{ time: '08:00' }, { time: '09:00' }, { time: '20:59' }])).invalidTimes).toBe(3);
  });

  it('accepts any alarm in a full-day window', () => {
    expect(scheduleIsValid(day({ on: '21:00', off: '21:00' }, [{ time: '13:00' }]))).toBe(true);
  });

  it('skips alarm checks when the night is off', () => {
    expect(scheduleIsValid(day({ enabled: false }, [{ time: '12:00' }]))).toBe(true);
  });
});
