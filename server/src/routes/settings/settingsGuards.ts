import { Settings } from '../../db/settingsSchema.js';

// Pulled out so this precondition is unit-testable without spinning up the
// route. `deepPartial()`-parsed POST /settings bodies only carry
// `features.levelTemps` when the caller is actually changing it, so an
// explicit `=== false` (not just falsy/absent) is the signal that the flag
// was flipped off. The effective format is the update's own value if the
// same request also changes it, otherwise whatever is already stored, so a
// single request that both disables the flag and switches the format away
// from level is allowed.
export function wouldOrphanLevelFormat(
  current: Settings,
  update: { features?: { levelTemps?: boolean }, temperatureFormat?: Settings['temperatureFormat'] },
): boolean {
  const disabling = update.features?.levelTemps === false;
  const effectiveFormat = update.temperatureFormat ?? current.temperatureFormat;
  return disabling && effectiveFormat === 'level';
}
