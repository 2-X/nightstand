import { Settings } from '../../db/settingsSchema.js';
import { Services } from '../../db/servicesSchema.js';

// Pulled out so the depends_on-biometrics relationship is unit-testable
// without spinning up either route. Sleep score and sleep stages need real
// biometrics data to mean anything, so the feature is only active when both
// its own flag and biometrics itself are on.
export function isSleepScoreActive(settings: Settings, services: Services): boolean {
  return settings.features.sleepScore && services.biometrics.enabled;
}
