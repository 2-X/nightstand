import { afterEach, describe, expect, it } from 'vitest';
import { THEMES } from '@design/themes';
import { THEME_IDS, THEME_STORAGE_KEY } from '@design/themes/ids';
import { themeBootScript } from '@design/themeBoot';
import { buildMuiTheme } from './theme';

type Overrides = Record<string, { styleOverrides?: { root?: Record<string, unknown> } }>;

describe.each(THEME_IDS)('the %s MUI theme', id => {
  const tokens = THEMES[id];
  const theme = buildMuiTheme(tokens);
  const root = (name: string) => (theme.components as Overrides)[name]?.styleOverrides?.root ?? {};

  it('takes colour, corner and type voice from its look', () => {
    expect(theme.palette.mode).toBe('dark');
    expect(theme.palette.primary.main).toBe(tokens.palette.accent);
    expect(theme.palette.background.default).toBe(tokens.palette.bg.base);
    expect(theme.palette.background.paper).toBe(tokens.palette.bg.elevated);
    expect(theme.palette.text.secondary).toBe(tokens.palette.text.secondary);
    expect(theme.shape.borderRadius).toBe(tokens.radius);
    expect(theme.typography.fontFamily).toBe(tokens.type.fontFamily);
    expect(theme.typography.h1.fontWeight).toBe(tokens.type.headingWeight);
    expect(theme.typography.body1.letterSpacing).toBe(tokens.type.bodyLetterSpacing);
    for (const name of ['MuiButton', 'MuiTab', 'MuiToggleButton']) {
      expect(root(name).textTransform, name).toBe(tokens.type.controlCase.textTransform);
      expect(root(name).letterSpacing, name).toBe(tokens.type.controlCase.letterSpacing);
    }
  });

  it('keeps the shared 44 px targets', () => {
    for (const name of ['MuiButton', 'MuiIconButton', 'MuiRadio', 'MuiCheckbox', 'MuiToggleButton', 'MuiTab', 'MuiTabs',
      'MuiInputBase', 'MuiListItemButton']) {
      expect(root(name).minHeight, name).toBe(44);
    }
    expect(root('MuiSwitch').height).toBe(44);
  });
});

describe('the page behind the app before it mounts', () => {
  const root = document.documentElement;
  afterEach(() => {
    localStorage.clear();
    root.removeAttribute('data-theme');
    root.removeAttribute('style');
  });

  // The boot script paints <html> before MUI loads; the two must agree or the page flashes on mount.
  it.each(THEME_IDS)('is the %s MUI background', id => {
    localStorage.setItem(THEME_STORAGE_KEY, id);
    new Function(themeBootScript())();
    const probe = document.createElement('div');
    probe.style.backgroundColor = buildMuiTheme(THEMES[id]).palette.background.default;
    expect(root.style.backgroundColor).toBe(probe.style.backgroundColor);
  });
});
