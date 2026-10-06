import config from '../config.js';
import servicesDB from '../db/services.js';
import logger from '../logger.js';
import { reconcileBiometrics } from './biometrics.js';
import { OperationBusyError } from './privilegedCommand.js';

let retry: NodeJS.Timeout | undefined;

// Updaters start the server before their unit exits. Wait until they stop moving the stream's code.
export async function syncBiometrics() {
  if (config.remoteDevMode) return;
  try {
    await reconcileBiometrics(async () => {
      await servicesDB.read();
      return servicesDB.data.biometrics.enabled;
    });
  } catch (error) {
    if (error instanceof OperationBusyError) {
      if (!retry) {
        retry = setTimeout(() => {
          retry = undefined;
          return syncBiometrics();
        }, 1_000);
        retry.unref();
      }
    } else {
      logger.error('Failed to reconcile the biometrics stream', error);
    }
  }
}
