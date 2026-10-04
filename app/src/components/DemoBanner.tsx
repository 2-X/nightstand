import { useState } from 'react';
import { Alert, Box, Link } from '@mui/material';
import { palette } from '@design/tokens';
import { bannerRailSx } from './pageRail';

const DISMISSED_KEY = 'nightstand-demo-banner-dismissed';

const wasDismissed = () => {
  try {
    return globalThis.sessionStorage.getItem(DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
};

export default function DemoBanner({ wide = false }: { wide?: boolean }) {
  const [dismissed, setDismissed] = useState(wasDismissed);
  if (dismissed) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      globalThis.sessionStorage.setItem(DISMISSED_KEY, 'true');
    } catch {
      // The bar stays dismissed for this view even where storage is blocked.
    }
  };
  return (
    <Box sx={ bannerRailSx(wide) }>
      <Alert
        role="none"
        severity="info"
        icon={ false }
        onClose={ dismiss }
        sx={ {
          py: 0, px: 1.5, minHeight: 48, alignItems: 'center',
          fontSize: 14, lineHeight: '20px', letterSpacing: 'normal',
          bgcolor: palette.bg.elevated, color: palette.text.secondary,
          '& .MuiAlert-message': { py: 1.5, minWidth: 0 },
          '& .MuiAlert-action': { p: 0, m: 0, ml: 'auto', pl: 1, alignSelf: 'center' },
        } }>
        Demo with sample data. Nothing here controls a real Pod.{ ' ' }
        <Link
          href="https://github.com/LTimothy/nightstand"
          target="_blank"
          rel="noopener noreferrer"
          sx={ {
            display: 'inline', fontSize: 'inherit', lineHeight: 'inherit', whiteSpace: 'nowrap',
            color: palette.accent, p: '14px 4px', m: '-14px -4px',
            '&:focus-visible': { outlineOffset: '-2px' },
          } }>
          View on GitHub
        </Link>
      </Alert>
    </Box>
  );
}
