import { Box } from '@mui/material';
import { media } from '@design/tokens';
import { useSettings } from '@api/settings.ts';
import { staleCaption } from './bedText';
import { useBedCaption } from './useBedCaption';

// Two lines tall whatever it says, and top-aligned, so a short caption starts where a long one does
// and nothing under it moves. Under 360 px the type steps down so the not responding lines still take two.
export const captionSlotSx = {
  width: '100%', height: 42, mt: '2px', fontSize: 15, lineHeight: 1.4, color: 'text.secondary', textAlign: 'center',
  textWrap: 'balance', [media.narrow]: { fontSize: 14 },
} as const;

const line = (text: string) => <Box component="span" key={ text } sx={ { display: 'block' } }>{ text }</Box>;

type CaptionSlotProps = {
  isOn: boolean;
  // While the Pod does not answer, the caption says so instead of promising a schedule.
  staleSince?: Date;
  // Nothing to say yet: the slot keeps its height.
  empty?: boolean;
};

export default function CaptionSlot({ isOn, staleSince, empty = false }: CaptionSlotProps) {
  const lines = useBedCaption(isOn);
  const { data: settings } = useSettings();
  // The status region is always there, empty unless stale, so a screen reader announces the lines when they arrive.
  return <Box data-caption-slot sx={ captionSlotSx }>
    <Box role="status">{ !empty && staleSince ? staleCaption(staleSince, settings?.timeZone).map(line) : null }</Box>
    { empty || staleSince ? null : lines.map(line) }
  </Box>;
}
