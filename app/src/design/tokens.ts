export const palette = {
  bg: {
    base: '#000000',
    elevated: '#121518',
    raised: '#1B2026',
    selected: '#303232',
    hover: 'rgba(255,255,255,0.08)',
  },
  border: {
    subtle: '#23282E',
    control: '#646D77',
    medium: 'rgba(255,255,255,0.12)',
  },
  text: {
    primary: '#E4E7EA',
    secondary: '#A3AAB2',
    tertiary: '#848C95',
    disabled: '#565D65',
  },
  lamp: '#E9E3D5',
  // A warm dark for the selected tile, the selected tab and Turn off.
  ember: '#2A251F',
  dial: {
    track: '#15171A',
    tick: '#2E3338',
    tickMajor: '#4E545B',
    tickZero: '#6E757C',
    tickOff: '#22262A',
    tickMajorOff: '#30353A',
    ghostOpacity: 0.18,
  },
  step: { fill: '#0B0B0C', cool: '#3E6A92', warm: '#8F673A', disabled: '#2E3338' },
  dock: { bg: '#13110F', border: '#25211C' },
  power: { offBorder: '#3A332A', onText: '#1A1814', nightBg: '#1C1915', nightBorder: 'rgba(233,227,213,0.55)' },
  tile: { selectedBorder: 'rgba(233,227,213,0.7)' },
  strip: {
    line: '#2A2E33',
    sleep: '#23272C',
    done: '#5A574F',
    dot: '#15171A',
    dotRing: '#30353B',
    chipText: '#1A1712',
    pastDot: '#111316',
    pastRing: '#24282D',
    pastChip: '#3B3832',
    latest: '#4A5058',
    pausedDash: '#363B41',
  },
  status: { ok: '#6CCB8E', warn: '#E8C95A', error: '#FF7A8A', info: '#A3AAB2' },
  stage: { awake: '#E9E3D5', rem: '#C3B5FF', light: '#8E80F0', deep: '#6A58E6' },
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 12, // primary card radius
  xxl: 24,
  pill: 9999,
};

// Numerals and headings on Bed ask for the rounded system face where there is one.
export const fonts = {
  rounded: 'ui-rounded, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};

// Bed's two extra breakpoints: phones under 360 px, and the two column desktop.
export const media = {
  narrow: '@media (max-width: 359.95px)',
  desktop: '@media (min-width: 900px)',
};

export const typography = {
  hero: {
    fontSize: 'clamp(3.5rem, 16vw, 4.5rem)',
    fontWeight: 300,
    lineHeight: 1,
    letterSpacing: '-0.03em',
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
    fontWeight: 600,
    letterSpacing: 'normal',
    textTransform: 'none' as const,
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
  // A text action in lamp colour with a 44 px target.
  lampLink: {
    minHeight: 44,
    minWidth: 0,
    px: '10px',
    color: palette.lamp,
    fontFamily: fonts.rounded,
    fontSize: 15,
    fontWeight: 600,
    textTransform: 'none' as const,
  },
};
