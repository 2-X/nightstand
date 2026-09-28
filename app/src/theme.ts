import { PaletteMode, alpha, createTheme, type Theme, type ThemeOptions } from '@mui/material/styles';

const HEADING_WEIGHT = 500;
const DARK_THEME_BORDER = '#2B333B';
const LIGHT_THEME_BORDER = '#E0E0E0';
const DARK_APP_BAR = '#080A0C';

const typography = {
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
  allVariants: {
    fontSize: 16,
    letterSpacing: 'normal',
  },
  h1: {
    fontSize: '1.75rem',
    fontWeight: HEADING_WEIGHT,
  },
  h2: {
    fontSize: '1.5rem',
    fontWeight: HEADING_WEIGHT,
  },
  h3: {
    fontSize: '1.75rem',
    fontWeight: HEADING_WEIGHT,
  },
  h4: {
    fontSize: '1.5rem',
    fontWeight: HEADING_WEIGHT,
  },
  h5: {
    fontSize: '1.25rem',
    fontWeight: HEADING_WEIGHT,
  },
  h6: {
    fontSize: '1rem',
    fontWeight: HEADING_WEIGHT,
  },
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
        },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
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
          borderColor,
        },
      },
    },
    MuiSelect: {
      styleOverrides: {
        select: {
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
            borderBottomColor: theme.palette.divider,
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
  ...(mode === 'dark' ? { primary: { main: '#A3C7DF' }, text: { primary: '#EDF1F4', secondary: '#A6ADB5' } } : {}),
  background:
    mode === 'dark'
      ? {
        default: '#080A0C',
        paper: '#15191E',
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
      borderRadius: 7,
    },
    components: buildComponents(mode),
  });

export const theme = buildTheme('dark');
