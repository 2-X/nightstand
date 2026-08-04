import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import moment from 'moment-timezone';
import { ServerStatusKey, StatusInfo } from '@api/serverStatusSchema.ts';
import { Box, Button, Typography } from '@mui/material';

import StatusChip from './StatusChip.tsx';
import { postJobs, JobSchema, Jobs } from '@api/jobs.ts';
import { useCalibration } from '@api/calibration.ts';
import { useState } from 'react';
import { palette } from '@design/tokens';
import { STATUS_META, GENERIC_MEANING } from './statusMeta.ts';
import CalibrationSubline from './CalibrationSubline.tsx';

type StatusRowProps = {
  statusInfo: StatusInfo;
  job: ServerStatusKey;
  divider: boolean;
};

export default function StatusRow({ job, statusInfo, divider }: StatusRowProps) {
  const meta = STATUS_META[job];
  const meaning = meta.meaning?.[statusInfo.status] ?? GENERIC_MEANING[statusInfo.status];
  const timestamp = statusInfo.timestamp && moment(statusInfo.timestamp).format('MMM D, h:mm A');
  // @ts-expect-error - JobSchema only covers the subset of status keys that are runnable
  const isRunnable = JobSchema.options.includes(job);
  const { data: calibration } = useCalibration();
  const calibrationSide = job === 'biometricsCalibrationLeft'
    ? 'left'
    : job === 'biometricsCalibrationRight' ? 'right' : null;

  const [disabled, setDisabled] = useState(false);
  const startJob = () => {
    setDisabled(true);
    postJobs([job] as Jobs).catch((error) => {
      console.error(error);
    });
    setTimeout(() => setDisabled(false), 30_000);
  };

  return (
    <Box sx={ { pt: divider ? 1.5 : 0, pb: 1.5, borderTop: divider ? `1px solid ${palette.border.subtle}` : 'none' } }>
      <Box sx={ { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5 } }>
        <Typography sx={ { fontSize: '0.95rem', fontWeight: 600, color: palette.text.primary, flex: 1, minWidth: 0 } }>
          { statusInfo.name }
        </Typography>
        <StatusChip info={ statusInfo } />
      </Box>

      <Typography sx={ { fontSize: '0.8rem', color: palette.text.tertiary, mt: 0.5, lineHeight: 1.4 } }>
        { meta.blurb }
      </Typography>

      <Typography
        sx={ {
          fontSize: '0.8rem',
          color: statusInfo.status === 'failed' ? palette.accent.red : palette.text.secondary,
          mt: 0.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        } }
      >
        { statusInfo.status === 'failed' && statusInfo.message ? `Error: ${statusInfo.message}` : meaning }
      </Typography>

      { calibrationSide && <CalibrationSubline view={ calibration?.[calibrationSide] }/> }

      { timestamp && (
        <Typography sx={ { fontSize: '0.7rem', color: palette.text.tertiary, mt: 0.25, opacity: 0.7 } }>
          { timestamp }
        </Typography>
      ) }

      { isRunnable && (
        <Box sx={ { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, mt: 1 } }>
          <Typography sx={ { fontSize: '0.75rem', color: palette.text.tertiary, flex: 1, lineHeight: 1.4 } }>
            { meta.runHint }
          </Typography>
          <Button
            onClick={ startJob }
            variant="outlined"
            size="small"
            disabled={ disabled || statusInfo.status === 'started' }
            startIcon={ <PlayArrowIcon /> }
            sx={ { flexShrink: 0 } }
          >
            Run
          </Button>
        </Box>
      ) }
    </Box>
  );
}
