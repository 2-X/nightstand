import { Box, Button, ButtonBase, Stack, Typography } from '@mui/material';
import Add from '@mui/icons-material/Add';
import ChevronRight from '@mui/icons-material/ChevronRight';
import type { SideRhythms } from '@api/rhythmsSchema';
import { palette, sx as tokens, weight } from '@design/tokens';
import { describeUsage, MAX_RHYTHMS_PER_SIDE, rhythmDetail, rhythmUsage } from './rhythmsModel';

type Props = {
  sideData: SideRhythms;
  today: string;
  disabled: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onUse: (id: string) => void;
};

export default function RhythmList({ sideData, today, disabled, onOpen, onNew, onUse }: Props) {
  const rhythms = Object.values(sideData.rhythms);
  const full = rhythms.length >= MAX_RHYTHMS_PER_SIDE;
  return <Stack spacing={ 1 } sx={ { width: '100%' } }>
    { rhythms.map(rhythm => {
      const usage = rhythmUsage(sideData, rhythm.id, today);
      const unused = !usage.days.length && !usage.dates.length;
      const detail = rhythmDetail(rhythm);
      return <Stack key={ rhythm.id } spacing={ 0.5 }>
        <ButtonBase
          aria-label={ `Edit ${rhythm.name}` }
          data-rhythm-id={ rhythm.id }
          disabled={ disabled }
          onClick={ () => onOpen(rhythm.id) }
          sx={ { ...tokens.glassCard, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, textAlign: 'left',
            '&.Mui-focusVisible': { outline: `2px solid ${palette.accent}`, outlineOffset: 2 } } }>
          <Box sx={ { minWidth: 0 } }>
            <Typography sx={ { fontSize: 16, fontWeight: weight.heading, overflowWrap: 'anywhere' } }><bdi>{ rhythm.name }</bdi></Typography>
            { detail !== rhythm.name && <Typography variant="body2" color="text.secondary">{ detail }</Typography> }
            <Typography variant="caption" color="text.secondary" sx={ { display: 'block' } }>
              { describeUsage(usage) }
            </Typography>
          </Box>
          <ChevronRight aria-hidden sx={ { color: 'text.secondary', flexShrink: 0 } }/>
        </ButtonBase>
        { unused && <Button
          data-use-rhythm={ rhythm.id }
          onClick={ () => onUse(rhythm.id) }
          disabled={ disabled }
          aria-label={ `Use ${rhythm.name} on some days` }
          sx={ { alignSelf: 'flex-start', px: 0, minHeight: 44 } }>
          Use on some days
        </Button> }
      </Stack>;
    }) }
    { rhythms.length === 0 && <Typography variant="body2" color="text.secondary">No rhythms yet.</Typography> }
    <Button startIcon={ <Add/> } onClick={ onNew } disabled={ disabled || full } sx={ { alignSelf: 'flex-start', px: 0 } }>New rhythm</Button>
    { full && <Typography variant="body2" color="text.secondary">A side can have up to { MAX_RHYTHMS_PER_SIDE } rhythms.</Typography> }
  </Stack>;
}
