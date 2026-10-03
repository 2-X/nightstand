import moment from 'moment-timezone';

export const NOT_RESPONDING = 'Not responding';

// Non-breaking, so a time never splits from its AM or PM.
export const NBSP = '\u00a0';

export function clockText(at: Date, timeZone?: string | null): string {
  return (timeZone ? moment.tz(at, timeZone) : moment(at)).format(`h:mm${NBSP}A`);
}

export function staleCaption(since: Date, timeZone?: string | null): [string, string] {
  return [`No response from the Pod since ${clockText(since, timeZone)}.`, 'Schedules and alarms may not run.'];
}

export const lastKnownAt = (since: Date, timeZone?: string | null) => `at ${clockText(since, timeZone)}`;
