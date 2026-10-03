import { DEFAULT_THEME_ID, THEME_STORAGE_KEY, isThemeId, type ThemeId } from './themes/ids';

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): ThemeStorage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

export function readStoredThemeId(storage: ThemeStorage | undefined = browserStorage()): ThemeId {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return isThemeId(value) ? value : DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function saveThemeId(id: ThemeId, storage: ThemeStorage | undefined = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(THEME_STORAGE_KEY, id);
    return true;
  } catch {
    return false;
  }
}

// The boot script in index.html has already chosen; storage covers pages where it did not run, as in tests.
export function activeThemeId(
  root: HTMLElement | undefined = globalThis.document?.documentElement,
  storage: ThemeStorage | undefined = browserStorage(),
): ThemeId {
  const booted = root?.dataset.theme;
  return isThemeId(booted) ? booted : readStoredThemeId(storage);
}
