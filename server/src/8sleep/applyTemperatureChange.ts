// Shared temperature-change primitive used by BOTH the tap-gesture path
// (frankenMonitor.processGesture) and the Pod 5 cover-button path
// (buttonMonitor). Extracted so the two callers apply identical semantics:
// read the current target from the live device status, add a signed delta,
// push it through updateDeviceStatus, and record it as a manual change so the
// schedule-override logic treats a physical adjustment the same regardless of
// which physical control produced it.
import { Side } from '../db/schedulesSchema.js';
import { DeviceStatus } from '../routes/deviceStatus/deviceStatusSchema.js';
import { updateDeviceStatus } from '../routes/deviceStatus/updateDeviceStatus.js';
import { markManualTempChange } from '../jobs/scheduleOverride.js';
import logger from '../logger.js';
import { DeepPartial } from 'ts-essentials';

/**
 * Apply a signed Fahrenheit delta to one side's target temperature.
 *
 * `currentTargetF` is the caller's most recent known target for the side (from
 * the live franken snapshot). Callers that lack a snapshot should not call this
 * (there is nothing to increment from); buttonMonitor skips the press instead
 * of guessing a base value.
 *
 * Mirrors frankenMonitor.processGesture's old temperature branch exactly:
 * updateDeviceStatus then markManualTempChange. Kept as a single await chain so
 * a rejection propagates to the caller, which is responsible for catching it
 * (an unhandled rejection shuts the whole server down).
 */
export async function applyTemperatureDelta(
  side: Side,
  currentTargetF: number,
  deltaF: number,
): Promise<number> {
  const newTargetF = currentTargetF + deltaF;
  logger.debug(
    `[applyTemperatureDelta] ${side}: ${currentTargetF} -> ${newTargetF} (delta ${deltaF})`,
  );
  await updateDeviceStatus(
    { [side]: { targetTemperatureF: newTargetF } } as DeepPartial<DeviceStatus>,
  );
  // Counts as a manual change for schedule-override purposes.
  await markManualTempChange(side, { from: currentTargetF, to: newTargetF });
  return newTargetF;
}
