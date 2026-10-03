import { afterEach, expect, it, vi } from 'vitest';
import { THEMES } from './themes';
import { DEFAULT_THEME_ID, THEME_IDS, THEME_STORAGE_KEY } from './themes/ids';

afterEach(() => {
  delete document.documentElement.dataset.theme;
  localStorage.clear();
  vi.resetModules();
});

const freshTokens = async () => {
  vi.resetModules();
  return import('./tokens');
};

it.each(THEME_IDS)('takes every token from the %s look the page booted with', async id => {
  document.documentElement.dataset.theme = id;
  const tokens = await freshTokens();
  expect(tokens.themeTokens.id).toBe(id);
  expect(tokens.palette).toEqual(THEMES[id].palette);
  expect(tokens.themeTokens.radius).toBe(THEMES[id].radius);
});

it('falls back to the stored look when the boot script did not run', async () => {
  localStorage.setItem(THEME_STORAGE_KEY, 'glass');
  expect((await freshTokens()).themeTokens.id).toBe('glass');
});

it('falls back to the default when nothing says otherwise', async () => {
  expect((await freshTokens()).themeTokens.id).toBe(DEFAULT_THEME_ID);
});
