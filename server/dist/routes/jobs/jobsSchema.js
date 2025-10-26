
!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[n]="31c99e5b-3563-54e6-9ff9-8fd663918704")}catch(e){}}();
import { z } from 'zod';
export const JobSchema = z.enum([
    'analyzeSleepLeft',
    'analyzeSleepRight',
    'biometricsCalibrationLeft',
    'biometricsCalibrationRight',
]);
// Schema for a list (array) of valid job keys
export const JobKeyListSchema = z.array(JobSchema);
//# sourceMappingURL=jobsSchema.js.map
//# debugId=31c99e5b-3563-54e6-9ff9-8fd663918704
