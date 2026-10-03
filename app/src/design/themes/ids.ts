export type ThemeId = 'nightstand' | 'lamp' | 'classic' | 'glass';

// Stored on devices: never rename an id. The order is the picker's.
export const THEME_IDS: readonly ThemeId[] = ['nightstand', 'lamp', 'classic', 'glass'];
export const DEFAULT_THEME_ID: ThemeId = 'nightstand';
// Namespaced because the hosted demo shares its origin with other pages.
export const THEME_STORAGE_KEY = 'nightstand-theme';

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);
}
