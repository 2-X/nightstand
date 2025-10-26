import { z } from 'zod';
export const JobSchema = z.enum([
    'analyzeSleepLeft',
    'analyzeSleepRight',
    'biometricsCalibrationLeft',
    'biometricsCalibrationRight',
]);
// Schema for a list (array) of valid job keys
export const JobKeyListSchema = z.array(JobSchema);
