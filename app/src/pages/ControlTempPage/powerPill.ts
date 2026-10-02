import { fonts, media, palette } from '@design/tokens';

export type PillKind = 'off' | 'on';

// Two matched dark pills: no light block on the screen at any hour.
const looks = {
  off: { bgcolor: palette.ember, color: palette.text.primary, boxShadow: `inset 0 0 0 1px ${palette.power.offBorder}` },
  on: { bgcolor: palette.power.nightBg, color: palette.lamp, boxShadow: `inset 0 0 0 1.5px ${palette.tile.selectedBorder}` },
} as const;

export function powerPillSx(kind: PillKind) {
  const look = looks[kind];
  return {
    flex: 'none',
    minWidth: 124,
    minHeight: 54,
    px: '22px',
    borderRadius: '27px',
    fontFamily: fonts.rounded,
    fontSize: 17,
    fontWeight: 650,
    textTransform: 'none',
    ...look,
    '&:hover': look,
    '&[aria-disabled="true"]': { cursor: 'default' },
    [media.narrow]: { minWidth: 100, px: '16px' },
  } as const;
}
