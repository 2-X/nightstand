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
  status: { ok: '#6CCB8E', warn: '#E8C95A', error: '#FF7A8A', info: '#A3AAB2' },
  stage: { awake: '#E9E3D5', rem: '#C3B5FF', light: '#8E80F0', deep: '#6A58E6' },
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20, // primary card radius
  xxl: 24,
  pill: 9999,
};

export const space = {
  // Numeric values for direct sx usage (multiplies of MUI's 8px base).
  // sx={{ p: space.cardPadding }} etc.
  cardPadding: 2.5, // 20px
  cardGap: 2, // 16px
  sectionGap: 3, // 24px
  inlineGap: 1, // 8px
};

export const typography = {
  hero: {
    fontSize: 'clamp(3.5rem, 16vw, 4.5rem)',
    fontWeight: 300,
    lineHeight: 1,
    letterSpacing: '-0.03em',
  },
  largeTitle: {
    fontSize: '1.75rem',
    fontWeight: 600,
    letterSpacing: '-0.01em',
    lineHeight: 1.15,
  },
  title: {
    fontSize: '1.375rem',
    fontWeight: 600,
    letterSpacing: '-0.01em',
  },
  metricLarge: { fontSize: '2.5rem', fontWeight: 400 },
  metricValue: {
    fontSize: '1.5rem',
    fontWeight: 500,
    fontVariantNumeric: 'tabular-nums',
  },
  body: {
    fontSize: '1rem',
    fontWeight: 400,
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
    p: space.cardPadding,
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
      px: space.cardPadding,
    },
    '& .MuiAccordionDetails-root': {
      px: space.cardPadding,
      pb: space.cardPadding,
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
};
