import { THEMES } from './themes';
import { activeThemeId } from './themePreference';

// Resolved once, before the first render: changing the look reloads the page.
export const themeTokens = THEMES[activeThemeId()];
export const palette = themeTokens.palette;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: themeTokens.radius, // primary card radius
  xxl: 24,
  pill: 9999,
};

// Bed's extra breakpoints: phones under 360 px, the two column desktop, and two steps of screens too short for
// the full layout to keep the power row above the bottom bar or the window's edge.
export const media = {
  narrow: '@media (max-width: 359.95px)',
  desktop: '@media (min-width: 900px)',
  short: '@media (max-height: 840px)',
  tight: '@media (max-height: 620px)',
  desktopShort: '@media (min-width: 900px) and (max-height: 840px)',
  // A short screen that is not the desktop layout.
  phoneShort: '@media (max-height: 840px) and (max-width: 899.95px)',
};

export const typography = {
  hero: {
    fontSize: 'clamp(3.5rem, 16vw, 4.5rem)',
    fontWeight: themeTokens.type.numeralWeight,
    lineHeight: 1,
    letterSpacing: `${themeTokens.type.numeralTrackingEm}em`,
  },
  metricLarge: { fontSize: '3.5rem', fontWeight: 500 },
  metricValue: {
    fontSize: '1.5rem',
    fontWeight: 500,
    fontVariantNumeric: 'tabular-nums',
  },
  caption: {
    fontSize: '0.8125rem',
    fontWeight: 400,
  },
  sectionLabel: {
    fontSize: '0.875rem',
    ...themeTokens.type.sectionLabel,
  },
};

// Shared sx blocks - drop-in style snippets.
export const sx = {
  glassCard: {
    width: '100%',
    borderRadius: `${radius.xl}px`,
    p: 2,
    background: palette.bg.elevated,
    border: `1px solid ${palette.border.subtle}`,
    boxShadow: 'none',
    overflowWrap: 'break-word' as const,
    wordBreak: 'break-word' as const,
  },
  // Shared accordion surface and spacing.
  glassAccordion: {
    width: '100%',
    borderRadius: `${radius.xl}px`,
    background: palette.bg.elevated,
    border: `1px solid ${palette.border.subtle}`,
    boxShadow: 'none',
    '&:before': { display: 'none' },
    '&.Mui-expanded': { margin: 0 },
    '& .MuiAccordionSummary-root': {
      borderRadius: `${radius.xl}px`,
      px: 2,
    },
    '& .MuiAccordionDetails-root': {
      px: 2,
      pb: 2,
    },
  },
  sectionLabel: {
    ...typography.sectionLabel,
    color: palette.text.tertiary,
    mb: 1.5,
  },
  rowDivider: {
    borderTop: `1px solid ${palette.border.subtle}`,
  },
  // A text action in the accent with a 44 px target.
  lampLink: {
    minHeight: 44,
    minWidth: 0,
    px: '10px',
    color: palette.accent,
    fontSize: 15,
    fontWeight: 600,
    textTransform: 'none' as const,
  },
};
