import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_THEME_ID, THEME_STORAGE_KEY } from './themes/ids';
import { activeThemeId, readStoredThemeId, saveThemeId } from './themePreference';

// Some browsers throw on the localStorage getter itself when site data is blocked.
function refuseStorage() {
  const own = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => { throw new DOMException('denied', 'SecurityError'); },
  });
  return () => {
    if (own) Object.defineProperty(globalThis, 'localStorage', own);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  };
}

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
});

it('uses the default when nothing is stored', () => {
  expect(readStoredThemeId()).toBe(DEFAULT_THEME_ID);
});

it('reads a stored look', () => {
  localStorage.setItem(THEME_STORAGE_KEY, 'classic');
  expect(readStoredThemeId()).toBe('classic');
});

it.each(['neon', '', 'Classic', 'null'])('ignores %j, which names no look', value => {
  localStorage.setItem(THEME_STORAGE_KEY, value);
  expect(readStoredThemeId()).toBe(DEFAULT_THEME_ID);
});

it('uses the default when reading throws', () => {
  const storage = { getItem: () => { throw new Error('denied'); }, setItem: vi.fn() };
  expect(readStoredThemeId(storage)).toBe(DEFAULT_THEME_ID);
});

it('uses the default, and reports a failed save, when the browser refuses storage', () => {
  const restore = refuseStorage();
  try {
    expect(readStoredThemeId()).toBe(DEFAULT_THEME_ID);
    expect(saveThemeId('glass')).toBe(false);
    expect(activeThemeId()).toBe(DEFAULT_THEME_ID);
  } finally {
    restore();
  }
});

it('saves a look on this device', () => {
  expect(saveThemeId('glass')).toBe(true);
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('glass');
});

it('reports a failed save when writing throws', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  expect(saveThemeId('glass')).toBe(false);
});

it('prefers the look the page booted with over storage', () => {
  localStorage.setItem(THEME_STORAGE_KEY, 'classic');
  document.documentElement.dataset.theme = 'glass';
  expect(activeThemeId()).toBe('glass');
});

it('falls back to storage when the booted look is unknown', () => {
  localStorage.setItem(THEME_STORAGE_KEY, 'classic');
  document.documentElement.dataset.theme = 'neon';
  expect(activeThemeId()).toBe('classic');
});
