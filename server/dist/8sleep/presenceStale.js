// The presence stream heartbeats about once a minute. If its last report is
// older than this we cannot tell "the bed is empty" from "nothing is
// reporting" (biometrics turned off, stream crashed, service restarting), so
// presence is UNKNOWN and nothing may treat it as absent.
export const PRESENCE_STALE_MS = 5 * 60 * 1000;
//# sourceMappingURL=presenceStale.js.map