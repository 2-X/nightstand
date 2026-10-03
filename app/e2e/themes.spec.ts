/// <reference lib="dom" />
import { test, expect } from '@playwright/test';
import { THEMES } from '../src/design/themes';
import { THEME_NAMES, THEME_PICKER_COPY } from '../src/design/themes/copy';
import { DEFAULT_THEME_ID, THEME_IDS, THEME_STORAGE_KEY } from '../src/design/themes/ids';
import { DESKTOP, NARROW, PHONE, SCREENS, openThemed, overflows, smallTargets } from './themeHelpers';

for (const id of THEME_IDS) {
  for (const screen of SCREENS) {
    for (const [label, size] of [['a phone', PHONE], ['a desktop', DESKTOP]] as const) {
      test(`${screen.name} in ${id} on ${label} fits the width and keeps 44 px targets`, async ({ page }) => {
        await openThemed(page, id, screen.path, size);
        await screen.ready(page);
        expect(await overflows(page)).toBe(false);
        expect(await smallTargets(page)).toEqual([]);
      });
    }
  }

  test(`bed in ${id} fits a 320 px phone`, async ({ page }) => {
    await openThemed(page, id, '/', NARROW);
    await SCREENS[0].ready(page);
    expect(await overflows(page)).toBe(false);
    expect(await smallTargets(page)).toEqual([]);
  });

  test(`${id} loads its fonts from the app's own origin`, async ({ page, baseURL }) => {
    const fonts: string[] = [];
    page.on('request', request => {
      if (/\.woff2(\?|$)/.test(new URL(request.url()).pathname)) fonts.push(request.url());
    });
    await openThemed(page, id, '/', PHONE);
    await SCREENS[0].ready(page);
    await page.evaluate(() => document.fonts.ready);
    expect(fonts.filter(url => new URL(url).origin !== new URL(baseURL!).origin)).toEqual([]);
    expect(fonts.length > 0).toBe(THEMES[id].type.font !== 'system');
  });
}

test('a device that never chose a look gets the default, painted before the app runs', async ({ page }) => {
  await openThemed(page, null, '/', PHONE);
  const background = await page.evaluate(() => document.documentElement.style.backgroundColor);
  const expected = await page.evaluate(colour => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = colour;
    return probe.style.backgroundColor;
  }, THEMES[DEFAULT_THEME_ID].palette.bg.base);
  expect(background).toBe(expected);
});

test('a stored value that names no look falls back to the default', async ({ page }) => {
  await page.addInitScript(key => localStorage.setItem(key, 'neon'), THEME_STORAGE_KEY);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', DEFAULT_THEME_ID);
});

test('choosing a look and using it saves it on this device and reloads into it', async ({ page }) => {
  const target = THEME_IDS.find(id => id !== DEFAULT_THEME_ID)!;
  await openThemed(page, null, '/settings/bed', PHONE);
  const group = page.getByRole('radiogroup', { name: THEME_PICKER_COPY.label });
  for (const radio of await group.getByRole('radio').all()) {
    const box = (await radio.locator('xpath=ancestor::label').boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await group.getByRole('radio', { name: THEME_NAMES[target] }).check();
  // Choosing only selects: nothing is saved and the page stays in its look until the button.
  await expect(page.locator('html')).toHaveAttribute('data-theme', DEFAULT_THEME_ID);
  expect(await page.evaluate(key => localStorage.getItem(key), THEME_STORAGE_KEY)).toBeNull();
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: THEME_PICKER_COPY.apply }).click(),
  ]);
  await expect(page.locator('html')).toHaveAttribute('data-theme', target);
  await expect(page.getByRole('radio', { name: THEME_NAMES[target] })).toBeChecked();
  expect(await page.evaluate(key => localStorage.getItem(key), THEME_STORAGE_KEY)).toBe(target);
});
