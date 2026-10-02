import { afterEach, expect, it } from 'vitest';
import { DEMO_READS_KEY, DEMO_WRITES_KEY, demoReads, demoWritesHang } from './demoPreferences';

afterEach(() => localStorage.clear());

it('holds device writes only when a spec asks', () => {
  expect(demoWritesHang()).toBe(false);
  localStorage.setItem(DEMO_WRITES_KEY, 'hang');
  expect(demoWritesHang()).toBe(true);
});

it('fails or holds the bed status only when a spec asks', () => {
  expect(demoReads()).toBeUndefined();
  localStorage.setItem(DEMO_READS_KEY, 'fail');
  expect(demoReads()).toBe('fail');
  localStorage.setItem(DEMO_READS_KEY, 'hang');
  expect(demoReads()).toBe('hang');
  localStorage.setItem(DEMO_READS_KEY, 'other');
  expect(demoReads()).toBeUndefined();
});
