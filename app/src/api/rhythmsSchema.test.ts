import { expect, it } from 'vitest';
import { responseSchema } from './responseSchema';
import { RhythmsDBSchema, RhythmsResponseSchema } from './rhythmsSchema';
import future from '../../../fixtures/compat/future/rhythmsDB.json';

it('reads a future rhythms file with unknown keys stripped and keeps writes strict', () => {
  const parsed = responseSchema(RhythmsDBSchema).parse(future);
  expect(JSON.stringify(parsed)).not.toContain('future');
  expect(parsed.left.week.monday).toBe('workday');
  const strict = RhythmsDBSchema.safeParse(future);
  expect(strict.success).toBe(false);
  const issues = strict.success ? [] : strict.error.issues;
  expect(new Set(issues.map(issue => issue.code))).toEqual(new Set(['unrecognized_keys']));
  const levels = issues.map(issue => issue.path.join('.'));
  for (const level of ['', 'left', 'left.rhythms.workday', 'left.rhythms.workday.night', 'left.rhythms.workday.night.power',
    'left.rhythms.workday.night.alarms.0', 'left.rhythms.workday.smart', 'left.week', 'left.changes.0']) {
    expect(levels).toContain(level);
  }
});

it('accepts the GET /rhythms shape before the file exists', () => {
  const body = { status: { enabled: false, active: false, reason: 'flag-off' }, data: null };
  expect(RhythmsResponseSchema.parse(body)).toEqual(body);
});
