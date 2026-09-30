type DiscardTitleInput = {
  day: string;
  otherDays: number;
  sideChange: boolean;
  side: 'left' | 'right';
  sideName?: string;
};

// Names what the discard prompt drops: the day, any copied days, and the side when switching sides.
export function discardTitle({ day, otherDays, sideChange, side, sideName }: DiscardTitleInput): string {
  const days = `${day}${otherDays ? ` and ${otherDays} more ${otherDays === 1 ? 'day' : 'days'}` : ''}`;
  const owner = sideName ? `${sideName}'s` : `the ${side} side's`;
  return `Discard changes to ${sideChange ? `${owner} ${days}` : days}?`;
}
