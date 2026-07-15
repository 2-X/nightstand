import MemoryIcon from '@mui/icons-material/Memory';
import { useMemory } from '@api/memory.ts';
import { palette } from '@design/tokens';
import { formatBytes } from '../../lib/formatBytes.ts';
import UsageBar from './UsageBar.tsx';

export default function MemoryIndicator() {
  // The pod has no swap, so RAM pressure can turn into an OOM kill quickly:
  // poll a bit more often than storage.
  const { data, isLoading } = useMemory(60_000);
  if (isLoading || !data) return null;

  return (
    <UsageBar
      icon={ <MemoryIcon sx={ { color: palette.text.secondary, fontSize: 20 } }/> }
      label="Memory"
      usedBytes={ data.usedBytes }
      totalBytes={ data.totalBytes }
      usedPercent={ data.usedPercent }
      caption={ `${formatBytes(data.availableBytes)} available` }
    />
  );
}
