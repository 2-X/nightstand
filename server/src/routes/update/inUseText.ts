// Shared by the server and app for software-change refusals.
export type InUseReasonText = 'left-on' | 'right-on' | 'alarm-soon' | 'status-unknown';

const SIDE_ON = 'A side is on. The bed keeps its current temperature, but schedules and alarms stop for up to five minutes.';
const ALARM_SOON = 'An alarm is due in the next 15 minutes. If it falls while Nightstand restarts, it will not ring.';
const UNKNOWN = "Nightstand cannot read the bed's state right now, so someone may be using it.";

export function inUseLines(reasons: InUseReasonText[]): string[] {
  const lines: string[] = [];
  if (reasons.includes('left-on') || reasons.includes('right-on')) lines.push(SIDE_ON);
  if (reasons.includes('status-unknown')) lines.push(UNKNOWN);
  if (reasons.includes('alarm-soon')) lines.push(ALARM_SOON);
  return lines;
}

export const inUseText = (reasons: InUseReasonText[]) => inUseLines(reasons).join(' ');
