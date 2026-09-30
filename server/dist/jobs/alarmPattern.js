// Pod 3 firmware rejects 'rise' and does not vibrate, and Pod 4 firmware
// falls back to 'double'. Only a hub known to be a Pod 5 gets the chosen
// pattern; any other hub gets 'double', which rings on every Pod.
export const supportsRisePattern = (hubVersion) => hubVersion === 'Pod 5';
export const alarmPatternFor = (hubVersion, chosen) => supportsRisePattern(hubVersion) ? chosen : 'double';
//# sourceMappingURL=alarmPattern.js.map