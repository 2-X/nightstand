import { useEffect, useRef } from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useNavigate } from 'react-router-dom';

import { useSettings } from '@api/settings.ts';
import { palette, typography } from '@design/tokens';
import {
  COMPARE_NAVIGATE,
  COMPARE_ROUTE_REPORT,
  isCompareMessage,
} from '@lib/compareMessages.ts';

const HEADER_HEIGHT = 44;

/**
 * Compare mode: the whole app twice, side by side. Each pane is an iframe of
 * this same app pinned to one bed side via ?side= (see appStore), so every
 * page works as a left/right comparison without per-page compare variants.
 * Panes report route changes up to this parent, which mirrors them to the
 * other pane so both always show the same page.
 */
export default function ComparePage() {
  const navigate = useNavigate();
  const { data: settings } = useSettings();
  const leftRef = useRef<HTMLIFrameElement>(null);
  const rightRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!isCompareMessage(event.data) || event.data.type !== COMPARE_ROUTE_REPORT) return;
      const fromLeft = event.source === leftRef.current?.contentWindow;
      const other = fromLeft ? rightRef.current : leftRef.current;
      other?.contentWindow?.postMessage(
        { type: COMPARE_NAVIGATE, path: event.data.path },
        window.location.origin,
      );
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const paneLabel = (side: 'left' | 'right') => settings?.[side]?.name ?? (side === 'left' ? 'Left' : 'Right');

  return (
    <Box sx={ { position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', backgroundColor: palette.bg.base } }>
      { /* Slim header: pane names + exit. */ }
      <Box
        sx={ {
          height: HEADER_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          borderBottom: `1px solid ${palette.border.subtle}`,
          flexShrink: 0,
        } }
      >
        { (['left', 'right'] as const).map((side) => (
          <Typography
            key={ side }
            sx={ {
              ...typography.sectionLabel,
              color: palette.text.secondary,
              flex: 1,
              textAlign: 'center',
            } }
          >
            { paneLabel(side) }
          </Typography>
        )) }
        <IconButton
          aria-label="Exit compare"
          onClick={ () => navigate('/') }
          sx={ { color: palette.text.secondary, mr: 0.5 } }
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      <Box sx={ { flex: 1, display: 'flex', minHeight: 0 } }>
        <Box
          component="iframe"
          ref={ leftRef }
          title={ `${paneLabel('left')} pane` }
          src="/?side=left"
          sx={ { flex: 1, border: 'none', minWidth: 0 } }
        />
        <Box sx={ { width: '1px', backgroundColor: palette.border.medium, flexShrink: 0 } } />
        <Box
          component="iframe"
          ref={ rightRef }
          title={ `${paneLabel('right')} pane` }
          src="/?side=right"
          sx={ { flex: 1, border: 'none', minWidth: 0 } }
        />
      </Box>
    </Box>
  );
}
