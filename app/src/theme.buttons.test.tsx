import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '@mui/material';
import { alpha, ThemeProvider } from '@mui/material/styles';
import { flatten, ratio } from '@test/colour';
import { THEMES } from '@design/themes';
import { THEME_IDS } from '@design/themes/ids';
import { buildMuiTheme } from './theme';

const TEXT = 4.5;
const COLOURS = ['primary', 'secondary', 'error'] as const;

describe.each(THEME_IDS)('buttons in the %s look', id => {
  const p = THEMES[id].palette;
  const theme = buildMuiTheme(THEMES[id]);
  // Where a button sits: the page, a card, dialog or draft bar, and for the accent the undo bar.
  const surfaces = { base: p.bg.base, elevated: p.bg.elevated };
  const accentSurfaces = { ...surfaces, raised: p.bg.raised };
  const drawn = (variant: 'contained' | 'outlined' | 'text', color: typeof COLOURS[number]) => {
    render(<ThemeProvider theme={ theme }><Button variant={ variant } color={ color }>Save</Button></ThemeProvider>);
    const style = getComputedStyle(screen.getByRole('button', { name: 'Save' }));
    return (name: string) => style.getPropertyValue(`--variant-${variant}${name}`).trim();
  };

  it.each(COLOURS)('labels a filled %s button at AA, at rest and on hover', color => {
    const css = drawn('contained', color);
    const label = css('Color');
    expect(label).toBe(theme.palette[color].contrastText);
    expect(ratio(label, css('Bg')), 'at rest').toBeGreaterThanOrEqual(TEXT);
    expect(ratio(label, theme.palette[color].dark), 'on hover').toBeGreaterThanOrEqual(TEXT);
  });

  it.each(COLOURS)('keeps a %s text or outlined label at AA, at rest and on hover', color => {
    const label = drawn('text', color)('Color');
    const hover = alpha(label, theme.palette.action.hoverOpacity);
    for (const [surface, below] of Object.entries(color === 'error' ? surfaces : accentSurfaces)) {
      expect(ratio(label, below), `on ${surface}`).toBeGreaterThanOrEqual(TEXT);
      expect(ratio(label, flatten(hover, below)), `on ${surface}, hovered`).toBeGreaterThanOrEqual(TEXT);
    }
  });
});
