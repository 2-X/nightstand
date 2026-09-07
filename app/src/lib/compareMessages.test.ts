import { describe, it, expect } from 'vitest';
import {
  COMPARE_NAVIGATE,
  COMPARE_ROUTE_REPORT,
  isCompareMessage,
  resolvePinnedSide,
} from './compareMessages';

describe('resolvePinnedSide', () => {
  it('parses left and right pins', () => {
    expect(resolvePinnedSide('?side=left')).toBe('left');
    expect(resolvePinnedSide('?side=right')).toBe('right');
  });

  it('returns null for absent or invalid values', () => {
    expect(resolvePinnedSide('')).toBeNull();
    expect(resolvePinnedSide('?foo=bar')).toBeNull();
    expect(resolvePinnedSide('?side=middle')).toBeNull();
  });
});

describe('isCompareMessage', () => {
  it('accepts both message types with a string path', () => {
    expect(isCompareMessage({ type: COMPARE_ROUTE_REPORT, path: '/alarms' })).toBe(true);
    expect(isCompareMessage({ type: COMPARE_NAVIGATE, path: '/' })).toBe(true);
  });

  it('rejects everything else (messages arrive from any window)', () => {
    expect(isCompareMessage(null)).toBe(false);
    expect(isCompareMessage('nightstand-compare-route')).toBe(false);
    expect(isCompareMessage({ type: 'other', path: '/' })).toBe(false);
    expect(isCompareMessage({ type: COMPARE_NAVIGATE, path: 42 })).toBe(false);
  });
});
