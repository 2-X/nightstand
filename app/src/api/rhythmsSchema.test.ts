import { expect, it } from 'vitest';
import { responseSchema } from './responseSchema';
import { RhythmsDBSchema, RhythmsResponseSchema } from './rhythmsSchema';
import future from '../../../fixtures/compat/future/rhythmsDB.json';

it('reads a future rhythms file with unknown keys stripped and keeps writes strict', () => {
  const parsed = responseSchema(RhythmsDBSchema).parse(future);
  expect(JSON.stringify(parsed)).not.toContain('future');
  expect(parsed.left.week.monday).toBe('workday');
  expect(RhythmsDBSchema.safeParse(future).success).toBe(false);
});

it('accepts the GET /rhythms shape before the file exists', () => {
  const body = { status: { enabled: false, active: false, reason: 'flag-off' }, data: null };
  expect(RhythmsResponseSchema.parse(body)).toEqual(body);
});
