import type { ThemeId } from './ids';

// Names and descriptions shown by the theme picker.
export const THEME_NAMES: Record<ThemeId, string> = {
  nightstand: 'Nightstand',
  lamp: 'Lamp',
  classic: 'free-sleep classic',
  glass: 'Glass',
};

export const THEME_PICKER_COPY = {
  label: 'Look',
  helper: "Saved on this device. free-sleep classic and Glass follow the looks of free-sleep by throwaway31265 and jmew's fork of it.",
  apply: 'Use this look',
  applyNote: 'The page reloads to apply it.',
  saveFailed: 'This device did not save the look, so the current one stays.',
};
