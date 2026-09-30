import express, { Request, Response } from 'express';
import moment from 'moment-timezone';
import logger from '../../logger.js';
import settingsDB from '../../db/settings.js';
import schedulesDB from '../../db/schedules.js';
import { SCHEDULE_SIDES } from '../../db/scheduleKeys.js';
import { Side } from '../../db/schedulesSchema.js';
import { loadRhythms, RhythmsLoad, RhythmsStateError, updateRhythms } from '../../db/rhythms.js';
import { RhythmsResponse, RhythmsSleepsQuerySchema, RhythmsUpdateSchema } from '../../db/rhythmsSchema.js';
import { activation } from '../../jobs/rhythms/activation.js';
import { applyAlarmsEnabled, findOverlaps, resolveLegacySleeps, resolveSleeps } from '../../jobs/rhythms/resolve.js';
import { pruneChanges, sideIssues } from '../../jobs/rhythms/validate.js';

const router = express.Router();

export const MAX_SLEEPS_WINDOW_MS = 16 * 24 * 60 * 60 * 1000;
// Weekly plans repeat and changes reach 60 days ahead, so this span sees every overlap.
const OVERLAP_CHECK_DAYS = 63;
const NOT_READY: Record<RhythmsLoad['state'], string> = {
  absent: 'Rhythms are not set up on this Pod',
  ok: 'Rhythms could not be saved',
  unsupported: 'The saved rhythms are from a newer version',
  invalid: 'The saved rhythms could not be read',
};

async function currentRhythms() {
  await settingsDB.read();
  await schedulesDB.read();
  const load = await loadRhythms();
  const result = activation(settingsDB.data, load, schedulesDB.data);
  const enabled = settingsDB.data.features?.rhythms === true;
  const body: RhythmsResponse = {
    status: result.active ? { enabled, active: true } : { enabled, active: false, reason: result.reason },
    data: load.state === 'ok' ? load.db : null,
  };
  return { body, result };
}

router.get('/rhythms', async (_req: Request, res: Response) => {
  const { body } = await currentRhythms();
  res.json(body);
});

router.post('/rhythms', async (req: Request, res: Response) => {
  const parsed = RhythmsUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.error('Invalid rhythms update:', parsed.error);
    res.status(400).json({ error: 'Invalid request data', details: parsed.error.errors });
    return;
  }
  await settingsDB.read();
  const { timeZone } = settingsDB.data;
  const today = moment.tz(timeZone).format('YYYY-MM-DD');
  // Old changes are dropped first, so one that names a deleted rhythm cannot block the save.
  const updates = SCHEDULE_SIDES.flatMap(side => {
    const sent = parsed.data[side];
    return sent ? [{ side, next: { ...sent, changes: pruneChanges(sent.changes, today) } }] : [];
  });
  // Sleeps that have ended are not checked, so an overlap never names two past dates.
  const from = new Date();
  const to = moment.tz(today, 'YYYY-MM-DD', timeZone).add(OVERLAP_CHECK_DAYS, 'days').toDate();
  let issues: string[] = [];
  let overlaps: Array<{ side: Side; first: string; second: string }> = [];
  try {
    await updateRhythms(draft => {
      if (!updates.length) return false;
      // Checked inside the write, so a concurrent save cannot restore a larger stored set point count.
      issues = updates.flatMap(({ side, next }) => sideIssues(next, today, draft[side]).map(issue => `${side}: ${issue}`));
      if (issues.length) return false;
      for (const { side, next } of updates) draft[side] = next;
      overlaps = updates.flatMap(({ side }) => findOverlaps({ db: draft, side, timeZone, from, to }).map(pair => ({ side, ...pair })));
      if (overlaps.length) return false;
    });
  } catch (error: unknown) {
    if (!(error instanceof RhythmsStateError)) throw error;
    res.status(409).json({ error: NOT_READY[error.state], state: error.state });
    return;
  }
  if (issues.length) {
    res.status(400).json({ error: 'Invalid rhythms', details: issues });
    return;
  }
  if (overlaps.length) {
    res.status(400).json({ error: 'Two sleeps would overlap', overlaps });
    return;
  }
  const { body } = await currentRhythms();
  res.json(body);
});

router.get('/rhythms/sleeps', async (req: Request, res: Response) => {
  const parsed = RhythmsSleepsQuerySchema.safeParse(req.query);
  const from = parsed.success ? new Date(parsed.data.from) : undefined;
  const to = parsed.success ? new Date(parsed.data.to) : undefined;
  if (!parsed.success || !from || !to || to <= from || to.getTime() - from.getTime() > MAX_SLEEPS_WINDOW_MS) {
    res.status(400).json({ error: 'Pass side, and from and to at most 16 days apart' });
    return;
  }
  const { side } = parsed.data;
  const { result } = await currentRhythms();
  const window = { side, timeZone: settingsDB.data.timeZone, from, to };
  const sleeps = result.active
    ? resolveSleeps({ db: result.db, ...window })
    : resolveLegacySleeps({ schedules: schedulesDB.data, ...window });
  res.json(applyAlarmsEnabled(sleeps, settingsDB.data[side].alarmsEnabled));
});

export default router;
