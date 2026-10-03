import { expect, it } from 'vitest';
import { formatBytes } from './formatBytes';

it('joins the number and its unit with a non-breaking space', () => {
  expect(formatBytes(512)).toBe('512 B');
  expect(formatBytes(1.6e9)).toBe('1.5 GB');
  expect(formatBytes(15e9)).toBe('14 GB');
});
