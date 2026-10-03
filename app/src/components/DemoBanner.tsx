import { useState } from 'react';
import { Alert, Box, Link } from '@mui/material';

const DISMISSED_KEY = 'nightstand-demo-banner-dismissed';

const wasDismissed = () => {
  try {
    return globalThis.sessionStorage.getItem(DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
};

export default function DemoBanner() {
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
    <Box sx={ { width: '100%', maxWidth: 600, boxSizing: 'border-box', px: 2 } }>
      <Alert role="none" severity="info" icon={ false } onClose={ dismiss } sx={ { py: 0, fontSize: 14 } }>
        Demo with sample data. Nothing here controls a real Pod.{ ' ' }
        <Link
          href="https://github.com/LTimothy/nightstand"
          target="_blank"
          rel="noopener noreferrer"
          sx={ { display: 'inline-flex', alignItems: 'center', minHeight: 44 } }>
          View on GitHub
        </Link>
      </Alert>
    </Box>
  );
}
