// The new sleep tracking has been checked only on a Pod 5 whose cover writes
// capSense2 capacitance records. Any other model is experimental whatever it
// writes; on a Pod 5, so is any recorded format but capSense2.
export const VALIDATED_MODEL = 'Pod 5';
export const VALIDATED_CAP_FORMATS: readonly string[] = ['capSense2'];

export const sleepTrackingExperimental = (
  coverVersion: string | undefined,
  hubVersion: string | undefined,
  capFormats: ReadonlyArray<string | null | undefined>,
): boolean => {
  if (coverVersion !== VALIDATED_MODEL || hubVersion !== VALIDATED_MODEL) return true;
  return capFormats.some((format) => typeof format === 'string' && !VALIDATED_CAP_FORMATS.includes(format));
};
