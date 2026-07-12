// Keeps a log-line buffer bounded so it can't grow without limit. Used for
// both the live `logs` list and the `pendingLogs` buffer that accumulates
// while the viewer is paused. A busy log file (the biometrics stream writes
// several times a second) can otherwise pile up an unbounded array in
// `pendingLogs` if the tab is left paused and open, which is a plausible
// source of memory pressure on a mobile browser.
export const MAX_LOG_LINES = 1000;

export const appendCapped = (
  prev: string[],
  next: string[],
  cap: number = MAX_LOG_LINES
): string[] => [...prev, ...next].slice(-cap);
