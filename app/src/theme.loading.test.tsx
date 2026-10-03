import { CircularProgress, LinearProgress, ThemeProvider } from '@mui/material';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { THEMES } from '@design/themes';
import { THEME_IDS } from '@design/themes/ids';
import { buildMuiTheme } from './theme';

// Loading is drawn grey in every look, never in the accent.
describe.each(THEME_IDS)('loading in the %s look', id => {
  const tokens = THEMES[id];
  const theme = buildMuiTheme(tokens);
  const probe = (colour: string) => {
    const el = document.createElement('div');
    el.style.color = colour;
    return el.style.color;
  };

  it('spins in the stale grey', () => {
    const { getByRole } = render(<ThemeProvider theme={ theme }><CircularProgress/></ThemeProvider>);
    expect(getComputedStyle(getByRole('progressbar')).color).toBe(probe(tokens.palette.text.tertiary));
  });

  it('fills the saving bar in the stale grey', () => {
    const { getByRole } = render(<ThemeProvider theme={ theme }><LinearProgress/></ThemeProvider>);
    const bar = getByRole('progressbar').querySelector('.MuiLinearProgress-bar') as HTMLElement;
    expect(probe(getComputedStyle(bar).backgroundColor)).toBe(probe(tokens.palette.text.tertiary));
    expect(probe(getComputedStyle(getByRole('progressbar')).backgroundColor)).toBe(probe(tokens.palette.border.subtle));
  });
});
