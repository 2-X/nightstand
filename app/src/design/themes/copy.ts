import type { ThemeId } from './ids';

// Names and descriptions shown by the theme picker.
export const THEME_NAMES: Record<ThemeId, string> = {
  nightstand: 'nightstand',
  lamp: 'lamp',
  classic: 'free-sleep classic',
  glass: 'jmew',
};

export const THEME_PICKER_COPY = {
  label: 'Theme',
  helper: "Saved on this device. free-sleep classic and jmew follow the original free-sleep app by throwaway31265 and jmew's fork of it.",
  apply: 'Use this theme',
  applyNote: 'The page reloads to apply it.',
  saveFailed: 'This device did not save the theme, so the current one stays.',
};
