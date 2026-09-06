import { describe, it, expect } from 'vitest';
import { cadenceLabel } from './cadence';

describe('cadenceLabel', () => {
  it('labels daily', () => {
    expect(cadenceLabel({ kind: 'daily' })).toBe('Every day');
  });
  it('labels weekdays', () => {
    expect(cadenceLabel({ kind: 'weekdays' })).toBe('Mon–Fri');
  });
  it('labels weekends', () => {
    expect(cadenceLabel({ kind: 'weekends' })).toBe('Sat–Sun');
  });
  it('labels an explicit custom-day list', () => {
    expect(cadenceLabel({ kind: 'customDays', days: [1, 3, 5] })).toBe('Mon Wed Fri');
  });
  it('recognizes customDays that form Mon-Fri', () => {
    expect(cadenceLabel({ kind: 'customDays', days: [1, 2, 3, 4, 5] })).toBe('Mon–Fri');
  });
  it('recognizes customDays that form the weekend', () => {
    expect(cadenceLabel({ kind: 'customDays', days: [0, 6] })).toBe('Sat–Sun');
  });
  it('labels everyNDays', () => {
    expect(cadenceLabel({ kind: 'everyNDays', n: 3, anchorDate: '2026-03-01' })).toBe('Every 3 days');
  });
  it('collapses everyNDays n=1 to Every day', () => {
    expect(cadenceLabel({ kind: 'everyNDays', n: 1, anchorDate: '2026-03-01' })).toBe('Every day');
  });
});
