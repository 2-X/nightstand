import { media, palette } from '@design/tokens';

export type PillKind = 'off' | 'on';

// Two matched dark pills: no light block on the screen at any hour.
const looks = {
  off: { bgcolor: palette.ember, color: palette.text.primary, boxShadow: `inset 0 0 0 1px ${palette.power.offBorder}` },
  on: { bgcolor: palette.power.nightBg, color: palette.lamp, boxShadow: `inset 0 0 0 1.5px ${palette.tile.selectedBorder}` },
} as const;

export function powerPillSx(kind: PillKind) {
  const look = looks[kind];
  return {
    width: '100%',
    minHeight: 54,
    borderRadius: '27px',
    fontSize: 17,
    fontWeight: 600,
    letterSpacing: '-0.005em',
    textTransform: 'none',
    ...look,
    '&:hover': look,
    '&[aria-disabled="true"]': { cursor: 'default' },
    [media.tight]: { minHeight: 48, borderRadius: '24px' },
  } as const;
}
