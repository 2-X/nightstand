import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import { postDeviceStatus } from '@api/deviceStatus.ts';
import { useAppStore } from '@state/appStore.tsx';
import { bedCommandMessage } from '@lib/requestError.ts';

type PrimeButtonProps = {
  refetch: any;
}

export default function PrimeButton({ refetch }: PrimeButtonProps) {
  const { setIsUpdating, isUpdating } = useAppStore();
  const [error, setError] = useState<string>();

  const handleClick = () => {
    setIsUpdating(true);
    postDeviceStatus({
      isPriming: true,
    })
      .then(() => {
        setError(undefined);
        // Wait 1 second before refreshing the device status
        return new Promise((resolve) => setTimeout(resolve, 1_000));
      })
      .then(() => refetch())
      .catch(error => {
        console.error(error);
        setError(bedCommandMessage(error));
      })
      .finally(() => {
        // Without this, isUpdating never clears and every control that disables
        // on it (power, temperature, prime) stays frozen until a reload.
        setIsUpdating(false);
      });
  };

  return <>
    <Button variant="contained" onClick={ handleClick } disabled={ isUpdating }>
      Prime now
    </Button>
    { error && <Alert severity="error" sx={ { mt: 1 } }>{ error }</Alert> }
  </>;
}
