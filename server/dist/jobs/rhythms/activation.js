import { legacyFingerprint } from './fingerprint.js';
// The Rhythms engine may run only when every check passes. Anything else
// leaves the weekly schedule in charge.
export function activation(settings, load, schedules) {
    if (settings.features?.rhythms !== true)
        return { active: false, reason: 'flag-off' };
    if (load.state === 'absent')
        return { active: false, reason: 'absent' };
    if (load.state === 'invalid')
        return { active: false, reason: 'invalid' };
    if (load.state === 'unsupported')
        return { active: false, reason: 'unsupported-version' };
    if (load.db.legacyFingerprint !== legacyFingerprint(schedules))
        return { active: false, reason: 'fingerprint-mismatch' };
    return { active: true, db: load.db };
}
//# sourceMappingURL=activation.js.map