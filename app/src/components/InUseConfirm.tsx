import { Alert, Stack } from '@mui/material';
import { inUseLines, type InUseReasonText } from '@api/bedInUse';

export default function InUseConfirm({ reasons }: { reasons: InUseReasonText[] | undefined }) {
  const lines = inUseLines(reasons ?? []);
  if (lines.length === 0) return null;
  return (
    <Alert severity="warning" sx={ { mb: 2 } }>
      <Stack spacing={ 0.5 }>{ lines.map(line => <span key={ line }>{ line }</span>) }</Stack>
    </Alert>
  );
}
