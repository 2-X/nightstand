import { ReactNode } from 'react';
import { Box, LinearProgress, Typography } from '@mui/material';
import { palette } from '@design/tokens';
import { formatBytes } from '../../lib/formatBytes.ts';

type UsageBarProps = {
  icon: ReactNode;
  label: string;
  usedBytes: number;
  totalBytes: number;
  usedPercent: number;
  caption?: ReactNode;
};

export default function UsageBar({ icon, label, usedBytes, totalBytes, usedPercent, caption }: UsageBarProps) {
  const barColor = usedPercent >= 90
    ? palette.accent.red
    : usedPercent >= 75
      ? palette.accent.orange
      : palette.accent.blue;

  return (
    <Box sx={ { mb: 1.5 } }>
      <Box sx={ { display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 } }>
        { icon }
        <Typography sx={ { fontSize: '1rem', color: palette.text.primary, flex: 1 } }>
          { label }
        </Typography>
        <Typography sx={ { fontSize: '0.85rem', color: palette.text.secondary } }>
          { formatBytes(usedBytes) } of { formatBytes(totalBytes) } used
        </Typography>
      </Box>

      <LinearProgress
        variant="determinate"
        value={ Math.min(usedPercent, 100) }
        sx={ {
          height: 6,
          borderRadius: 3,
          backgroundColor: palette.bg.elevated,
          '& .MuiLinearProgress-bar': { backgroundColor: barColor, borderRadius: 3 },
        } }
      />

      { caption && (
        <Typography sx={ { fontSize: '0.75rem', color: palette.text.tertiary, mt: 0.75 } }>
          { caption }
        </Typography>
      ) }
    </Box>
  );
}
