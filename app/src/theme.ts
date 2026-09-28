import { PaletteMode, alpha, createTheme, type Theme, type ThemeOptions } from '@mui/material/styles';

import { palette } from '@design/tokens';

const HEADING_WEIGHT = 600;
const DARK_THEME_BORDER = palette.border.subtle;
const LIGHT_THEME_BORDER = '#E0E0E0';
const DARK_APP_BAR = palette.bg.base;

const typography = {
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
  allVariants: {
    fontSize: 16,
    letterSpacing: 'normal',
    fontVariantNumeric: 'tabular-nums',
  },
  h1: {
    fontSize: '1.75rem',
    fontWeight: HEADING_WEIGHT,
    lineHeight: 1.15,
    letterSpacing: '-0.01em',
  },
  h2: {
    fontSize: '1.375rem',
    fontWeight: HEADING_WEIGHT,
  },
  h3: {
    fontSize: '1.125rem',
    fontWeight: HEADING_WEIGHT,
  },
  h4: {
    fontSize: '1rem',
    fontWeight: HEADING_WEIGHT,
  },
  h5: {
    fontSize: '1rem',
    fontWeight: HEADING_WEIGHT,
  },
  h6: {
    fontSize: '0.875rem',
    fontWeight: HEADING_WEIGHT,
  },
  body1: { fontSize: '1rem', lineHeight: 1.5 },
  body2: { fontSize: '0.875rem', lineHeight: 1.5 },
  caption: { fontSize: '0.8125rem' },
} satisfies ThemeOptions['typography'];

const getBorderColor = (mode: PaletteMode) => (mode === 'dark' ? DARK_THEME_BORDER : LIGHT_THEME_BORDER);

const getFilledChipStyles = (theme: Theme, paletteKey: 'success' | 'info' | 'warning' | 'secondary') => {
  const paletteColor = theme.palette[paletteKey];
  const overlay = theme.palette.mode === 'light' ? 0.15 : 0.35;

  return {
    backgroundColor: alpha(paletteColor.main, overlay),
    color:
      theme.palette.mode === 'light'
        ? (paletteColor.dark ?? paletteColor.main)
        : (paletteColor.light ?? paletteColor.contrastText ?? theme.palette.getContrastText(paletteColor.main)),
    border: 'none',
  };
};

const buildComponents = (mode: PaletteMode) => {
  const borderColor = getBorderColor(mode);
  return {
    MuiCssBaseline: {
      styleOverrides: {
        summary: { minHeight: 44, paddingBlock: 10, boxSizing: 'border-box', cursor: 'pointer' },
        ':focus-visible': { outline: `2px solid ${palette.lamp}`, outlineOffset: '3px' },
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': {
            animationDuration: '0.01ms !important',
            animationIterationCount: '1 !important',
            transitionDuration: '0.01ms !important',
            scrollBehavior: 'auto !important',
          },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          minHeight: 44,
        },
      },
    },
    MuiSlider: { styleOverrides: { root: { padding: '20px 0' }, thumb: { '&::after': { width: 44, height: 44 } } } },
    MuiSwitch: {
      styleOverrides: { root: { width: 64, height: 44, padding: 15 }, switchBase: { padding: 12 } },
    },
    MuiRadio: { styleOverrides: { root: { minWidth: 44, minHeight: 44 } } },
    MuiCheckbox: { styleOverrides: { root: { minWidth: 44, minHeight: 44 } } },
    MuiIconButton: { styleOverrides: { root: { minWidth: 44, minHeight: 44 } } },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          minHeight: 44,
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
        },
      },
    },
    MuiFormControlLabel: {
      styleOverrides: {
        label: {
          textTransform: 'none',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: `1px solid ${borderColor}`,
          boxShadow: 'none',
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        variant: 'standard',
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          textTransform: 'none',
        },
      },
    },
    MuiFormHelperText: {
      styleOverrides: {
        root: {
          fontSize: '0.9rem',
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        notchedOutline: {
          borderColor: mode === 'dark' ? palette.border.control : borderColor,
        },
      },
    },
    MuiInputBase: {
      styleOverrides: { root: { minHeight: 44 }, input: { minHeight: 44, boxSizing: 'border-box' } },
    },
    MuiSelect: {
      styleOverrides: {
        select: {
          minHeight: '44px !important',
          boxSizing: 'border-box',
          display: 'flex', alignItems: 'center',
          fontSize: 16,
        },
      },
    },
    MuiAutocomplete: {
      styleOverrides: {
        input: {
          fontSize: 16,
        },
      },
    },
    MuiInput: {
      styleOverrides: {
        input: {
          fontSize: 16,
        },
        underline: ({ theme }) => ({
          '&:before': {
            borderBottomColor: theme.palette.mode === 'dark' ? palette.border.control : theme.palette.divider,
          },
        }),
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          borderTop: 'none',
          borderLeft: 'none',
          borderRight: 'none',
          borderBottomColor: `${borderColor} !important`,
          boxShadow: 'none',
          backgroundColor: mode === 'dark' ? DARK_APP_BAR : 'rgb(245, 245, 245)',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          fontWeight: 500,
        },
        colorSuccess: ({ theme }) => getFilledChipStyles(theme, 'success'),
        colorInfo: ({ theme }) => getFilledChipStyles(theme, 'info'),
        colorWarning: ({ theme }) => getFilledChipStyles(theme, 'warning'),
        colorSecondary: ({ theme }) => getFilledChipStyles(theme, 'secondary'),
      },
    },
  } satisfies ThemeOptions['components'];
};

const buildPalette = (mode: PaletteMode): ThemeOptions['palette'] => ({
  mode,
  divider: getBorderColor(mode),
  ...(mode === 'dark' ? {
    primary: { main: palette.lamp }, secondary: { main: palette.lamp },
    success: { main: palette.status.ok }, warning: { main: palette.status.warn },
    error: { main: palette.status.error }, info: { main: palette.status.info },
    text: { primary: palette.text.primary, secondary: palette.text.secondary, disabled: palette.text.disabled },
  } : {}),
  background:
    mode === 'dark'
      ? {
        default: palette.bg.base,
        paper: palette.bg.elevated,
      }
      : {
        default: 'rgb(250, 250, 250)',
        paper: 'rgb(255, 255, 255)',
      },
});

export const buildTheme = (mode: PaletteMode = 'dark') =>
  createTheme({
    typography,
    palette: buildPalette(mode),
    shape: {
      borderRadius: 12,
    },
    components: buildComponents(mode),
  });

export const theme = buildTheme('dark');
