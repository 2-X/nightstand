// The server and the app use the same rule.
export { sleepTrackingExperimental } from '../../../server/src/features/sleepTrackingValidation.ts';

export const EXPERIMENTAL_ON_THIS_POD = 'Experimental on this Pod: only checked on a Pod 5 so far. '
  + 'It changes the nightly sleep records, not the in-bed indicator or auto-off.';
