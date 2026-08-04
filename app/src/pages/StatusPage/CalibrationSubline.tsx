import moment from 'moment-timezone';
import { Typography } from '@mui/material';
import { palette } from '@design/tokens';
import { CalibrationView } from '@api/calibration.ts';

// Quality below this reads as thin rather than trustworthy. It changes the
// wording only. A thin calibration never turns the row red: reporting a
// working, modest result as a failure is a mistake this codebase has already
// made once.
const LOW_QUALITY = 0.4;

type Props = { view: CalibrationView | undefined };

export default function CalibrationSubline({ view }: Props) {
  if (!view) return null;

  const when = view.calibratedAt ? moment.unix(view.calibratedAt).fromNow() : null;
  const isLowConfidence = view.state === 'calibrated'
    && view.quality !== null
    && view.quality < LOW_QUALITY;

  return (
    <Typography sx={ { fontSize: '0.75rem', color: palette.text.tertiary, mt: 0.25 } }>
      { when ? `Calibrated ${when}. ` : '' }
      { view.summary }
      { isLowConfidence ? ' Low confidence, a longer empty stretch will improve it.' : '' }
    </Typography>
  );
}
