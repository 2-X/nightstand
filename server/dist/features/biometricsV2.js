import settingsDB from '../db/settings.js';
// Read on every call, so a change in Settings applies without a restart.
export function biometricsV2Enabled() {
    return settingsDB.data.features?.biometricsV2 === true;
}
//# sourceMappingURL=biometricsV2.js.map