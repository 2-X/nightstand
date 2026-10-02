/// <reference lib="dom" />
import { test, expect, type Page } from '@playwright/test';
import { BED_SIZES, BED_STATES, openBedState } from './bedStates';

type Box = { x: number; y: number; width: number; height: number } | null;

// Page positions, so a scroll does not count as movement.
const measure = (page: Page) => page.evaluate(() => {
  const box = (selector: string) => {
    const node = document.querySelector(selector);
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.top + window.scrollY, width: rect.width, height: rect.height };
  };
  return {
    powerRow: box('[data-power-row]'),
    caption: box('[data-caption-slot]'),
    controls: box('[data-controls-row]'),
    tonight: box('[data-tonight]'),
    scrollWidth: document.documentElement.scrollWidth,
  };
});

// Every visible control on the Bed controls, the Tonight card and the chip is at least 44 px each way.
// The link inside the away sentence is text, and is left out.
const smallControls = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll([
  '[data-bed-controls] button', '[data-bed-controls] a[href]', '[data-bed-controls] label',
  '[data-tonight] button', '[data-tonight] a[href]', '[data-last-night-chip] a[href]',
].join(', ')))
  .filter(node => !node.closest('[data-power-row] p'))
  .map(node => ({ text: node.textContent?.trim() ?? '', rect: node.getBoundingClientRect() }))
  .filter(({ rect }) => rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44))
  .map(({ text, rect }) => `${text} ${Math.round(rect.width)}x${Math.round(rect.height)}`));

const expectSameBox = (actual: Box, expected: Box, name: string) => {
  expect(actual, name).not.toBeNull();
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(actual![key] - expected![key]), `${name} ${key}`).toBeLessThanOrEqual(1);
  }
};

for (const [width, height] of BED_SIZES) {
  for (const state of BED_STATES) {
    test(`${state} at ${width}x${height} keeps every slot where the on state has it`, async ({ context }) => {
      const reference = await openBedState(context, 'on', { width, height });
      const expected = await measure(reference);
      await reference.close();

      const page = await openBedState(context, state, { width, height });
      const actual = await measure(page);
      expectSameBox(actual.powerRow, expected.powerRow, 'power row');
      expectSameBox(actual.caption, expected.caption, 'caption slot');
      expectSameBox(actual.controls, expected.controls, 'controls row');
      if (width === 390) expect(Math.abs(actual.tonight!.y - expected.tonight!.y), 'Tonight top').toBeLessThanOrEqual(1);
      expect(actual.scrollWidth).toBeLessThanOrEqual(width);
      expect(await smallControls(page)).toEqual([]);
    });
  }
}
