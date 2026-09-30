import { useEffect, useState } from 'react';
import { Alert, Button, Box } from '@mui/material';
import { useAppStore } from '@state/appStore.tsx';
import useAnalyzeSleep from '@lib/useAnalyzeSleep';
import AnalyzeSleepNotification from './AnalyzeSleepNotification.tsx';
import { useControlTempStore } from './controlTempStore.tsx';

// Turning a side off moves Turn on up into the gap the Turn off button left,
// so a prompt shown there is easy to hit with a second tap meant for the
// power button. It lives with the other cards instead, and only appears once
// that tap window has passed.
const SHOW_AFTER_MS = 3_000;
const HIDE_AFTER_MS = 20_000;

export default function AnalyzeLastNightPrompt() {
  const { side } = useAppStore();
  const poweredOff = useControlTempStore(state => state.poweredOff);
  const { analyze, canAnalyze, isPending: analyzing, error: analysisError, alreadyQueued } = useAnalyzeSleep();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(false);
    if (poweredOff?.side !== side) return;
    const elapsed = Date.now() - poweredOff.at;
    if (elapsed >= HIDE_AFTER_MS) return;
    const timers = [
      window.setTimeout(() => setVisible(true), Math.max(0, SHOW_AFTER_MS - elapsed)),
      window.setTimeout(() => setVisible(false), Math.max(0, HIDE_AFTER_MS - elapsed)),
    ];
    return () => timers.forEach(window.clearTimeout);
  }, [poweredOff, side]);

  if (!visible && !analyzing && !analysisError) return null;

  return (
    <Box sx={ { display: 'flex', flexDirection: 'column', gap: 2 } }>
      { visible && canAnalyze && (
        <Button variant="text" onClick={ () => void analyze() }>Analyze last night</Button>
      ) }
      { analysisError && <Alert severity="error">Could not start sleep analysis. Try again.</Alert> }
      { analyzing && <AnalyzeSleepNotification alreadyQueued={ alreadyQueued }/> }
    </Box>
  );
}
