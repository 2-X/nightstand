import { afterEach, beforeEach, expect, it } from 'vitest';
import { THEMES } from './themes';
import { DEFAULT_THEME_ID, THEME_IDS, THEME_STORAGE_KEY } from './themes/ids';
import { themeBootScript } from './themeBoot';

const root = document.documentElement;
const run = () => { new Function(themeBootScript())(); };
const css = (colour: string) => {
  const probe = document.createElement('div');
  probe.style.backgroundColor = colour;
  return probe.style.backgroundColor;
};
const metaContent = (name: string) => document.querySelector(`meta[name="${name}"]`)?.getAttribute('content');

beforeEach(() => {
  document.head.innerHTML = '<meta name="theme-color" content="#000000"><meta name="msapplication-TileColor" content="#000000">';
});
afterEach(() => {
  localStorage.clear();
  root.removeAttribute('data-theme');
  root.removeAttribute('style');
});

it.each(THEME_IDS)('boots the stored %s look with its background', id => {
  localStorage.setItem(THEME_STORAGE_KEY, id);
  run();
  expect(root.dataset.theme).toBe(id);
  expect(root.style.backgroundColor).toBe(css(THEMES[id].palette.bg.base));
  expect(metaContent('theme-color')).toBe(THEMES[id].palette.bg.base);
  expect(metaContent('msapplication-TileColor')).toBe(THEMES[id].palette.bg.base);
});

it('boots the default when nothing is stored', () => {
  run();
  expect(root.dataset.theme).toBe(DEFAULT_THEME_ID);
});

it('boots the default when the stored value names no look', () => {
  localStorage.setItem(THEME_STORAGE_KEY, 'toString');
  run();
  expect(root.dataset.theme).toBe(DEFAULT_THEME_ID);
});

it('boots the default when the browser refuses storage', () => {
  const own = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new DOMException('denied', 'SecurityError'); } });
  try {
    run();
    expect(root.dataset.theme).toBe(DEFAULT_THEME_ID);
  } finally {
    if (own) Object.defineProperty(window, 'localStorage', own);
    else delete (window as { localStorage?: Storage }).localStorage;
  }
});
