import { useEffect, useState } from 'react';
import { Typography } from '@mui/material';
import { palette } from '@design/tokens';

const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export default function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    // Tick on the browser's own clock, not the pod's: this is the device in
    // the user's hand/nightstand, so a glance here is a quick sanity check
    // against pod clock drift (the failure mode that motivated adding this).
    // Aligning to the next minute boundary keeps the displayed minute from
    // visibly lagging by up to a full interval.
    const msIntoMinute = now.getSeconds() * 1000 + now.getMilliseconds();
    const alignTimeout = setTimeout(() => setNow(new Date()), 60_000 - msIntoMinute);
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => {
      clearTimeout(alignTimeout);
      clearInterval(interval);
    };
  }, [now]);

  return (
    <Typography
      sx={ {
        fontSize: '0.9rem',
        fontWeight: 500,
        color: palette.text.tertiary,
        fontVariantNumeric: 'tabular-nums',
      } }
    >
      { timeFormatter.format(now) }
    </Typography>
  );
}
