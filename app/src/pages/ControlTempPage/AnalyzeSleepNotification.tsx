import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';

export default function AnalyzeSleepNotification({ alreadyQueued = false }: { alreadyQueued?: boolean }) {
  return (
    <Alert severity="info">
      { alreadyQueued ? 'Already queued or running. Results will appear in Sleep.' : 'Analyzing last night. Results will appear in Sleep.' }
      &nbsp;
      <CircularProgress size={ 15 } sx={ {} }/>
    </Alert>
  );
}
