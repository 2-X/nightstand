import { Box } from '@mui/material';
import { useBedCaption } from './useBedCaption';

// Two lines tall whatever it says, and top-aligned, so a short caption starts where a long one does
// and nothing under it moves.
export const captionSlotSx = {
  width: '100%', height: 42, mt: '2px', fontSize: 15, lineHeight: 1.4, color: 'text.secondary', textAlign: 'center',
  textWrap: 'balance',
} as const;

export default function CaptionSlot({ isOn }: { isOn: boolean }) {
  const lines = useBedCaption(isOn);
  return <Box data-caption-slot sx={ captionSlotSx }>
    { lines.map(line => <Box component="span" key={ line } sx={ { display: 'block' } }>{ line }</Box>) }
  </Box>;
}
