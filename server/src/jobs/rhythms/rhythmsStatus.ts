import serverStatus from '../../serverStatus.js';
import type { StatusInfo } from '../../routes/serverStatus/serverStatusSchema.js';
import type { Activation } from './activation.js';
import type { RhythmsPlan } from './scheduleRhythms.js';

const NAME = 'Rhythms schedule';
const DESCRIPTION = 'Plans the sleeps set in Rhythms for the next 48 hours';

function inactiveMessage(reason: Exclude<Activation, { active: true }>['reason']): string {
  if (reason === 'absent') return 'Rhythms data is missing, so the weekly schedule is running.';
  if (reason === 'invalid') return 'Rhythms data could not be read, so the weekly schedule is running.';
  if (reason === 'unsupported-version') return 'Rhythms data is from a newer version of Nightstand, so the weekly schedule is running.';
  return 'The weekly schedule changed in another version, so the weekly schedule is running. '
    + 'Choose Go back to Rhythms on the Schedule page to use your rhythms.';
}

function activeStatus(plan: RhythmsPlan, timeZone: string | null): Pick<StatusInfo, 'status' | 'message'> {
  if (!timeZone) return { status: 'not_started', message: 'No time zone is set, so no sleeps are planned.' };
  if (plan.failedSides.length > 0) {
    const sides = plan.failedSides.length > 1 ? `${plan.failedSides.join(' and ')} sides` : `${plan.failedSides[0]} side`;
    return { status: 'failed', message: `Could not plan Rhythms for the ${sides}. Check the log.` };
  }
  return { status: 'healthy', message: `${plan.jobCount} job(s) planned` };
}

export function reportRhythmsStatus(engine: Activation, plan: RhythmsPlan, timeZone: string | null): void {
  if (engine.active) {
    serverStatus.status.rhythmsSchedule = { name: NAME, description: DESCRIPTION, ...activeStatus(plan, timeZone) };
    return;
  }
  if (engine.reason === 'flag-off') {
    delete serverStatus.status.rhythmsSchedule;
    return;
  }
  const broken = engine.reason === 'absent' || engine.reason === 'invalid';
  serverStatus.status.rhythmsSchedule = {
    name: NAME,
    description: DESCRIPTION,
    status: broken ? 'failed' : 'not_started',
    message: inactiveMessage(engine.reason),
  };
}
