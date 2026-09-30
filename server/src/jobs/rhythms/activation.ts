import { Settings } from '../../db/settingsSchema.js';
import { Schedules } from '../../db/schedulesSchema.js';
import { ACTIVATION_REASONS, RhythmsDB } from '../../db/rhythmsSchema.js';
import type { RhythmsLoad } from '../../db/rhythms.js';
import { legacyFingerprint } from './fingerprint.js';

export type Activation =
  | { active: true; db: RhythmsDB }
  | { active: false; reason: (typeof ACTIVATION_REASONS)[number] };

// The Rhythms engine may run only when every check passes. Anything else
// leaves the weekly schedule in charge.
export function activation(settings: Settings, load: RhythmsLoad, schedules: Schedules): Activation {
  if (settings.features?.rhythms !== true) return { active: false, reason: 'flag-off' };
  if (load.state === 'absent') return { active: false, reason: 'absent' };
  if (load.state === 'invalid') return { active: false, reason: 'invalid' };
  if (load.state === 'unsupported') return { active: false, reason: 'unsupported-version' };
  if (load.db.legacyFingerprint !== legacyFingerprint(schedules)) return { active: false, reason: 'fingerprint-mismatch' };
  return { active: true, db: load.db };
}
