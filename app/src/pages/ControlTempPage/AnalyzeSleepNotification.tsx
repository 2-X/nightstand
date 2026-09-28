import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';

export default function AnalyzeSleepNotification() {
  return (
    <Alert severity="info">
      Analyzing last night. Results will appear in Sleep.
      &nbsp;
      <CircularProgress size={ 15 } sx={ {} }/>
    </Alert>
  );
}
