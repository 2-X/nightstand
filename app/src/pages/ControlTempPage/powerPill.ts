import { media, palette, weight } from '@design/tokens';

export type PillKind = 'off' | 'on';

// Two matched dark pills: no light block on the screen at any hour.
const looks = {
  off: { bgcolor: palette.power.offBg, color: palette.power.offText, boxShadow: `inset 0 0 0 1px ${palette.power.offBorder}` },
  on: { bgcolor: palette.power.nightBg, color: palette.accent, boxShadow: `inset 0 0 0 1.5px ${palette.tile.selectedBorder}` },
} as const;

export function powerPillSx(kind: PillKind) {
  const look = looks[kind];
  return {
    width: '100%',
    minHeight: 54,
    borderRadius: '27px',
    fontSize: 17,
    fontWeight: weight.heading,
    letterSpacing: '-0.005em',
    textTransform: 'none',
    ...look,
    '&:hover': look,
    '&[aria-disabled="true"]': { cursor: 'default' },
    [media.tight]: { minHeight: 48, borderRadius: '24px' },
  } as const;
}

// Try again in the calm pill, greyed like a stepper that cannot be used while a change saves.
export const retryPillSx = {
  ...powerPillSx('on'),
  '&[aria-disabled="true"]': {
    color: palette.text.disabled, boxShadow: `inset 0 0 0 1.5px ${palette.step.disabled}`, cursor: 'default',
  },
} as const;
