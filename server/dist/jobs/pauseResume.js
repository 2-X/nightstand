import schedule from 'node-schedule';
import { resumeSchedule } from './resumeSchedule.js';
import logger from '../logger.js';
import { updateSettings } from '../db/settings.js';
// The clear runs after the end, not at it, so an alarm due exactly at the end
// still reads the pause however node-schedule orders jobs due together.
export const PAUSE_RESUME_DELAY_MS = 60 * 1000;
// Clears only the pause that ended, so a newer pause saved meanwhile stays.
// An off side resumes the current night after the pause is cleared.
export async function clearEndedPause(side, expiresAt) {
    let cleared = false;
    try {
        await updateSettings(draft => {
            const pause = draft[side].scheduleOverrides.pause;
            if (!pause?.active || pause.expiresAt !== expiresAt)
                return false;
            draft[side].scheduleOverrides.pause = { active: false, expiresAt: '' };
            cleared = true;
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to end the ${side} schedule pause: ${message}`);
        return false;
    }
    if (cleared) {
        logger.info(`Schedule pause for ${side} ended at ${expiresAt}`);
        const endedAt = new Date(expiresAt);
        await resumeSchedule(side, Number.isFinite(endedAt.getTime()) ? endedAt : new Date());
    }
    return cleared;
}
// Resolves true when a pause that already ended was cleared now. The
// settings write then triggers the usual reschedule.
export async function schedulePauseResume(settings, side, now = new Date()) {
    const pause = settings[side]?.scheduleOverrides?.pause;
    if (!pause?.active || !pause.expiresAt)
        return false;
    const { expiresAt } = pause;
    const end = Date.parse(expiresAt);
    if (!Number.isFinite(end) || end + PAUSE_RESUME_DELAY_MS <= now.getTime())
        return clearEndedPause(side, expiresAt);
    logger.debug(`Scheduling the ${side} schedule pause to end at ${expiresAt}`);
    schedule.scheduleJob(`${side}-pause-resume`, new Date(end + PAUSE_RESUME_DELAY_MS), () => clearEndedPause(side, expiresAt));
    return false;
}
//# sourceMappingURL=pauseResume.js.map