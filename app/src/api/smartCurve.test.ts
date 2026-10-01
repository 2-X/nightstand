import { describe, expect, it } from 'vitest';
import { buildCurve, levelToF, warmsBeforeBedtime } from './smartCurve.ts';
import { levelToFahrenheit } from '../lib/temperatureConversions.ts';
import type { SmartSchedule } from './rhythmsSchema.ts';

describe('smartCurve in the app', () => {
  it('uses the same level mapping as the app', () => {
    for (let level = -10; level <= 10; level++) expect(levelToF(level)).toBe(levelToFahrenheit(level));
  });

  it('builds the standard example with the browser time zone data', () => {
    const points = buildCurve({
      smart: { baseLevel: 0, intensity: 'standard', warmStart: true, warmUp: true, upEarly: false },
      bedtime: new Date('2026-09-30T05:45:00Z'),
      coolStart: new Date('2026-09-30T06:00:00Z'),
      wake: new Date('2026-09-30T13:30:00Z'),
      powerOff: new Date('2026-09-30T14:30:00Z'),
      timeZone: 'America/Los_Angeles',
    });
    expect(points.map(point => point.level)).toEqual([2, 2, 2, 1, 0, -1, -2, -2, -1, 0, 1, 2, 0]);
    expect(points[0].at.toISOString()).toBe('2026-09-30T05:15:00.000Z');
    expect(points[points.length - 1].phase).toBe('after');
  });

  it('says the bed warms before bedtime only when the pre-warm is above neutral', () => {
    const curve = (smart: Partial<SmartSchedule>) => buildCurve({
      smart: { baseLevel: 0, intensity: 'standard', warmStart: true, warmUp: true, upEarly: false, ...smart },
      bedtime: new Date('2026-09-30T05:45:00Z'),
      coolStart: new Date('2026-09-30T05:45:00Z'),
      wake: new Date('2026-09-30T13:30:00Z'),
      powerOff: new Date('2026-09-30T14:30:00Z'),
      timeZone: 'America/Los_Angeles',
    });
    expect(warmsBeforeBedtime(curve({}))).toBe(true);
    expect(warmsBeforeBedtime(curve({ warmStart: false }))).toBe(false);
    const cool = curve({ baseLevel: -7 });
    expect(cool[0].level).toBeLessThan(0);
    expect(warmsBeforeBedtime(cool)).toBe(false);
    expect(warmsBeforeBedtime([])).toBe(false);
  });
});
