import { expect, it } from 'vitest';
import { getSettings } from './mockData';
import { getMockRhythms } from './rhythmsMock';
import { demoRhythmsDefault } from './demoPreferences';

it('keeps unit tests on the weekly schedule', () => {
  expect(demoRhythmsDefault()).toBe(false);
  expect(getSettings().features.rhythms).toBe(false);
  expect(getMockRhythms()).toBeNull();
});
