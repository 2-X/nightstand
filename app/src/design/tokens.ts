import { THEMES } from './themes';
import { activeThemeId } from './themePreference';

// Resolved once, before the first render: changing the look reloads the page.
export const themeTokens = THEMES[activeThemeId()];
export const palette = themeTokens.palette;

// One corner per look. A mark is a small bar or code chip, cornered in proportion.
export const radius = {
  base: themeTokens.radius,
  mark: Math.max(2, Math.round(themeTokens.radius / 3)),
  pill: 9999,
};

export const weight = {
  regular: 400,
  medium: themeTokens.type.mediumWeight,
  heading: themeTokens.type.headingWeight,
  numeral: themeTokens.type.numeralWeight,
};

// The temperature numeral's tracking; the level numeral sits a little tighter.
export const numeralTracking = (offsetEm = 0) => `${Math.round((themeTokens.type.numeralTrackingEm + offsetEm) * 1000) / 1000}em`;

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
    fontWeight: weight.numeral,
    lineHeight: 1,
    letterSpacing: numeralTracking(),
  },
  metricLarge: { fontSize: '3.5rem', fontWeight: weight.medium },
  metricValue: {
    fontSize: '1.5rem',
    fontWeight: weight.medium,
    fontVariantNumeric: 'tabular-nums',
  },
  caption: {
    fontSize: '0.8125rem',
    fontWeight: weight.regular,
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
    borderRadius: `${radius.base}px`,
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
    borderRadius: `${radius.base}px`,
    background: palette.bg.elevated,
    border: `1px solid ${palette.border.subtle}`,
    boxShadow: 'none',
    '&:before': { display: 'none' },
    '&.Mui-expanded': { margin: 0 },
    '& .MuiAccordionSummary-root': {
      borderRadius: `${radius.base}px`,
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
    fontWeight: weight.heading,
    textTransform: 'none' as const,
  },
};
