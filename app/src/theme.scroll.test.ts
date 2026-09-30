import { expect, it } from 'vitest';
import { theme } from './theme';

it('scrolls focused controls clear of the fixed bars', () => {
  const overrides = theme.components?.MuiCssBaseline?.styleOverrides as Record<string, Record<string, unknown>>;
  const html = overrides.html;
  // The bottom navigation is 64px plus the safe-area inset on phones.
  expect(html.scrollPaddingBottom).toContain('64px');
  expect(html.scrollPaddingBottom).toContain('safe-area-inset-bottom');
  // The top bar takes over from md up.
  expect(html['@media (min-width: 900px)']).toMatchObject({ scrollPaddingTop: '80px' });
});
