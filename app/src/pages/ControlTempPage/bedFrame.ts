// Two missed 60 s polls.
export const STALE_AFTER_MS = 120_000;

export type DialStatus = { isOn: boolean; targetTemperatureF: number; currentTemperatureF: number };

export type BedFrame =
  | { kind: 'loading' }
  | { kind: 'live'; status: DialStatus }
  | { kind: 'stale'; since: Date; status?: DialStatus };

export type BedFrameInput = {
  // The selected side from the last good status, if there is one.
  status?: DialStatus;
  hasData: boolean;
  isError: boolean;
  isFetching: boolean;
  failureCount: number;
  dataUpdatedAt: number;
  // When the page first asked, for a first load that fails.
  requestedAt: number;
  now: number;
};

// Live only while the last status is at most two minutes old and the last request did not fail. A refresh under way
// that has not failed yet, such as the one a tab starts when it comes back to the front, gets the benefit of the doubt.
export function bedFrame(input: BedFrameInput): BedFrame {
  if (!input.hasData && !input.isError) return { kind: 'loading' };
  if (!input.hasData || !input.status) return { kind: 'stale', since: new Date(input.requestedAt) };
  const old = input.now - input.dataUpdatedAt > STALE_AFTER_MS && (!input.isFetching || input.failureCount > 0);
  if (input.isError || old) return { kind: 'stale', since: new Date(input.dataUpdatedAt), status: input.status };
  return { kind: 'live', status: input.status };
}
