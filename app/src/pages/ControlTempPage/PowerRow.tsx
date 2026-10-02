import { useLayoutEffect, useRef, type FocusEvent } from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { useAppStore } from '@state/appStore.tsx';
import { useSettings } from '@api/settings.ts';
import { media, palette } from '@design/tokens';
import PowerButton, { type PowerButtonProps } from './PowerButton';

type PowerRowProps = {
  isOn: boolean;
  refetch: PowerButtonProps['refetch'];
  // Puts Try again in the button's place while the Pod does not answer.
  onRetry?: () => void;
  // Empty at its full height while the status loads.
  loading?: boolean;
};

// One height whatever it holds, so nothing under it moves.
const rowSx = {
  width: '100%', minHeight: 54, mt: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center',
  [media.short]: { mt: '6px' },
  [media.tight]: { mt: '2px', minHeight: 48 },
} as const;

export default function PowerRow({ isOn, refetch, onRetry, loading = false }: PowerRowProps) {
  const { side } = useAppStore();
  const { data: settings } = useSettings();
  const away = !!settings?.[side]?.awayMode;
  const sentence = !loading && !onRetry && away;
  // Whether focus is in the row. A focused control that is removed leaves it set, so what takes its place gets focus,
  // as Turn off and Try again keep it by being one button.
  const row = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  const onBlur = ({ target }: FocusEvent) => queueMicrotask(() => {
    if (target.isConnected) focused.current = false;
  });
  useLayoutEffect(() => {
    if (focused.current && (!document.activeElement || document.activeElement === document.body)) {
      row.current?.querySelector<HTMLElement>('a, button')?.focus();
    }
  }, [sentence]);
  return <Box ref={ row } data-power-row sx={ rowSx } onFocus={ () => { focused.current = true; } } onBlur={ onBlur }>
    { loading ? null : sentence ? <Typography sx={ { fontSize: 15, color: 'text.secondary', textAlign: 'center' } }>
      Away mode is on. Change it in <Link
        to="/settings/bed"
        style={ { color: palette.text.primary, textDecoration: 'underline', textUnderlineOffset: 2 } }>Settings, Bed and sides</Link>.
    </Typography>
      : <PowerButton isOn={ isOn } refetch={ refetch } onRetry={ onRetry }/> }
  </Box>;
}
