// The new sleep tracking has been checked only on a Pod 5 whose cover writes
// capSense2 capacitance records. The recorded format decides; the model is the
// fallback until a format is recorded.
export const VALIDATED_MODEL = 'Pod 5';
export const VALIDATED_CAP_FORMATS: readonly string[] = ['capSense2'];

export const sleepTrackingExperimental = (
  coverVersion: string | undefined,
  hubVersion: string | undefined,
  capFormats: ReadonlyArray<string | null | undefined>,
): boolean => {
  const known = capFormats.filter((format): format is string => typeof format === 'string');
  if (known.length > 0) return known.some((format) => !VALIDATED_CAP_FORMATS.includes(format));
  return coverVersion !== VALIDATED_MODEL || hubVersion !== VALIDATED_MODEL;
};
