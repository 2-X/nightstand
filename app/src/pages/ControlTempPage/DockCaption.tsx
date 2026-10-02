import { Box, Typography } from '@mui/material';
import { media } from '@design/tokens';
import { useBedCaption } from './useBedCaption';

export const dockTextSx = {
  fontSize: 15, lineHeight: 1.35, color: 'text.secondary', textWrap: 'balance', [media.narrow]: { fontSize: 14 },
} as const;
// A fixed height, so a short caption starts where a long one does and the dock never changes size with its text.
// The longest caption takes three lines until the dock is as wide as on a 390 px phone.
export const dockSlotSx = {
  ...dockTextSx, flex: 1, minWidth: 0, height: `${3 * dockTextSx.lineHeight}em`,
  '@container (min-width: 330px)': { height: `${2 * dockTextSx.lineHeight}em` },
} as const;

export default function DockCaption({ isOn }: { isOn: boolean }) {
  const lines = useBedCaption(isOn);
  return <Box data-dock-caption sx={ dockSlotSx }>
    { lines.map(line => <Typography key={ line } sx={ dockTextSx }>{ line }</Typography>) }
  </Box>;
}
