import StorageIcon from '@mui/icons-material/Storage';
import { useStorage } from '@api/storage.ts';
import { palette } from '@design/tokens';
import { formatBytes } from '../../lib/formatBytes.ts';
import UsageBar from './UsageBar.tsx';

export default function StorageIndicator() {
  // Storage rarely changes second-to-second: a slow poll is enough to
  // notice the biometrics archive or logs growing over days, not seconds.
  const { data, isLoading } = useStorage(5 * 60_000);
  if (isLoading || !data) return null;

  const caption = [
    `${formatBytes(data.availableBytes)} free`,
    data.breakdown.biometricsArchiveBytes > 0 && `${formatBytes(data.breakdown.biometricsArchiveBytes)} biometrics archive`,
    `${formatBytes(data.breakdown.logsBytes)} logs`,
  ].filter(Boolean).join(' · ');

  return (
    <UsageBar
      icon={ <StorageIcon sx={ { color: palette.text.secondary, fontSize: 20 } }/> }
      label="Storage"
      usedBytes={ data.usedBytes }
      totalBytes={ data.totalBytes }
      usedPercent={ data.usedPercent }
      caption={ caption }
    />
  );
}
