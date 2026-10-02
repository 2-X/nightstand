import { afterEach, expect, it } from 'vitest';
import { DEMO_WRITES_KEY, demoWritesHang } from './demoPreferences';

afterEach(() => localStorage.clear());

it('holds device writes only when a spec asks', () => {
  expect(demoWritesHang()).toBe(false);
  localStorage.setItem(DEMO_WRITES_KEY, 'hang');
  expect(demoWritesHang()).toBe(true);
});
