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
    // Align once to the next minute boundary, then tick every minute. Keying
    // this effect on `now` (as it once was) rebuilt both timers every tick and
    // left two of them firing at the boundary, so this runs once with an
    // empty dep array instead.
    let interval: ReturnType<typeof setInterval> | undefined;
    const start = new Date();
    const msIntoMinute = start.getSeconds() * 1000 + start.getMilliseconds();
    const alignTimeout = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 60_000);
    }, 60_000 - msIntoMinute);
    return () => {
      clearTimeout(alignTimeout);
      if (interval) clearInterval(interval);
    };
  }, []);

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
