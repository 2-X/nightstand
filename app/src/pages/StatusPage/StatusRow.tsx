import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import moment from 'moment-timezone';
import { ServerStatusKey, StatusInfo } from '@api/serverStatusSchema.ts';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';

import StatusChip from './StatusChip.tsx';
import { postJobs, JobSchema, Jobs } from '@api/jobs.ts';
import { useCalibration } from '@api/calibration.ts';
import { useId, useState } from 'react';
import { palette } from '@design/tokens';
import { STATUS_META, GENERIC_MEANING } from './statusMeta.ts';
import CalibrationSubline from './CalibrationSubline.tsx';

type StatusRowProps = {
  statusInfo: StatusInfo;
  job: ServerStatusKey;
  divider: boolean;
};

export default function StatusRow({ job, statusInfo, divider }: StatusRowProps) {
  const titleId = useId();
  const meta = STATUS_META[job];
  const meaning = meta.meaning?.[statusInfo.status] ?? GENERIC_MEANING[statusInfo.status];
  const timestamp = statusInfo.timestamp && moment(statusInfo.timestamp).format('MMM D, h:mm A');
  // @ts-expect-error - JobSchema only covers the subset of status keys that are runnable
  const isRunnable = JobSchema.options.includes(job);
  const { data: calibration } = useCalibration();
  const calibrationSide = job === 'biometricsCalibrationLeft'
    ? 'left'
    : job === 'biometricsCalibrationRight' ? 'right' : null;

  const [request, setRequest] = useState<'idle' | 'pending' | 'accepted' | 'failed'>('idle');
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [requestedTimestamp, setRequestedTimestamp] = useState<string>();
  const actionLabel = meta.runLabel ?? `Run ${statusInfo.name}`;
  const newStatus = statusInfo.timestamp !== undefined && statusInfo.timestamp !== requestedTimestamp;
  let feedback: string | undefined;
  if (request === 'failed') feedback = 'Could not start this job. Try again.';
  else if (request === 'pending') feedback = 'Sending request...';
  else if (request === 'accepted') {
    if (statusInfo.status === 'started') feedback = 'Running.';
    else if (newStatus && statusInfo.status === 'healthy') feedback = 'Completed, as reported by the server.';
    else if (newStatus && statusInfo.status === 'failed') feedback = `Job failed: ${statusInfo.message || 'Check the logs and try again.'}`;
    else if (newStatus && statusInfo.status === 'waiting_for_data') feedback = 'Waiting for enough sensor data.';
    else feedback = 'Request accepted. Waiting for the server to report progress.';
  }
  const failed = request === 'failed' || (request === 'accepted' && newStatus && statusInfo.status === 'failed');
  const startJob = async () => {
    setConfirmationOpen(false);
    setRequestedTimestamp(statusInfo.timestamp);
    setRequest('pending');
    try {
      await postJobs([job] as Jobs);
      setRequest('accepted');
    } catch {
      setRequest('failed');
    }
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
        <Box sx={ { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5, mt: 1 } }>
          <Typography sx={ { fontSize: '0.75rem', color: palette.text.tertiary, flex: 1, lineHeight: 1.4 } }>
            { meta.runHint }
          </Typography>
          <Button
            onClick={ () => calibrationSide ? setConfirmationOpen(true) : void startJob() }
            variant="outlined"
            size="small"
            disabled={ request === 'pending' || (request === 'accepted' && !newStatus) || statusInfo.status === 'started' }
            startIcon={ <PlayArrowIcon /> }
            sx={ { flexShrink: 0 } }
          >
            { actionLabel }
          </Button>
        </Box>
      ) }
      { feedback && <Alert role={ failed ? 'alert' : 'status' } severity={ failed ? 'error' : 'info' } sx={ { mt: 1 } }>{ feedback }</Alert> }
      <Dialog aria-labelledby={ titleId } open={ confirmationOpen } onClose={ () => setConfirmationOpen(false) }>
        <DialogTitle id={ titleId }>{ actionLabel }?</DialogTitle>
        <DialogContent>
          Keep the { calibrationSide } side empty before continuing. Manual calibration uses the last
          two hours of sensor data and bypasses the automatic occupancy check. Remove people and pets
          from this side; if it has been occupied recently, wait for an empty stretch first.
        </DialogContent>
        <DialogActions>
          <Button onClick={ () => setConfirmationOpen(false) }>Cancel</Button>
          <Button onClick={ () => void startJob() }>{ actionLabel }</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
