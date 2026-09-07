// Phase 2 recurring-alarm API. Distinct from the existing POST /api/alarm
// (fire-an-alarm-now command in routes/alarm/alarm.ts).
//
//   GET  /api/alarms                    -> { left: RecurringAlarm[], right: [] }
//   PUT  /api/alarms/:side              -> replace a side's list
//   GET  /api/alarms/upcoming?hours=N   -> concrete next occurrences, both sides
//
// A write bumps recurringAlarmsDB.json; the chokidar watcher in jobScheduler
// picks up the change and re-arms jobs, so there is no need to touch the
// scheduler from here.

import express, { Request, Response } from 'express';
import { z } from 'zod';
import moment from 'moment-timezone';

import logger from '../../logger.js';
import recurringAlarmsDB from '../../db/recurringAlarms.js';
import settingsDB from '../../db/settings.js';
import { RecurringAlarmsSchema, SideSchema } from '../../db/schedulesSchema.js';
import { expandAlarmOccurrences } from '../../jobs/recurrenceExpansion.js';
import { recordConfigAudit } from '../../db/collector.js';

const router = express.Router();

router.get('/alarms', async (_req: Request, res: Response) => {
  await recurringAlarmsDB.read();
  res.json({
    left: recurringAlarmsDB.data.left ?? [],
    right: recurringAlarmsDB.data.right ?? [],
  });
});

// Replace one side's list wholesale. The editor sends the full array; a
// whole-list PUT keeps the merge logic trivial and the file a single source of
// truth (no partial-merge ambiguity across add/edit/delete).
router.put('/alarms/:side', async (req: Request, res: Response) => {
  const sideParse = SideSchema.safeParse(req.params.side);
  if (!sideParse.success) {
    res.status(400).json({ error: 'Invalid side', details: sideParse.error.errors });
    return;
  }
  const side = sideParse.data;

  const listParse = RecurringAlarmsSchema.safeParse(req.body);
  if (!listParse.success) {
    logger.error('Invalid recurring alarms update:', listParse.error);
    res.status(400).json({ error: 'Invalid request data', details: listParse.error.errors });
    return;
  }

  // Reject duplicate ids within the list; the id is the stable handle the
  // scheduler re-arms against and the editor keys rows on.
  const ids = listParse.data.map((a) => a.id);
  if (new Set(ids).size !== ids.length) {
    res.status(400).json({ error: 'Duplicate alarm ids in list' });
    return;
  }

  await recurringAlarmsDB.read();
  recurringAlarmsDB.data[side] = listParse.data;
  recurringAlarmsDB.data._migrated = true;
  await recurringAlarmsDB.write();
  recordConfigAudit('recurringAlarms', `PUT /api/alarms/${side}`, listParse.data);
  res.status(200).json(recurringAlarmsDB.data[side]);
});

const UpcomingQuerySchema = z.object({
  hours: z.coerce.number().min(1).max(24 * 14).optional(),
  side: SideSchema.optional(),
});

// Concrete next occurrences across both sides (or one, with ?side=), sorted by
// time. Used by the Tonight page to place alarm markers.
router.get('/alarms/upcoming', async (req: Request, res: Response) => {
  const parsed = UpcomingQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request data', details: parsed.error.errors });
    return;
  }
  const hours = parsed.data.hours ?? 12;
  const onlySide = parsed.data.side;

  await recurringAlarmsDB.read();
  await settingsDB.read();
  const timeZone = settingsDB.data.timeZone || moment.tz.guess() || 'UTC';

  const fromMs = Date.now();
  const toMs = fromMs + hours * 60 * 60 * 1000;

  const sides = onlySide ? [onlySide] : (['left', 'right'] as const);
  const occurrences: Array<{
    side: string;
    alarmId: string;
    time: string;
    epochMs: number;
    iso: string;
    vibration: unknown;
    warmRampMinutes?: number;
    smartWake?: { enabled: boolean; windowMinutes: number };
    // When smart wake is enabled, the instant the wake window opens
    // (occurrence - windowMinutes), so the Tonight page can draw the window.
    smartWakeStartMs?: number;
  }> = [];

  for (const side of sides) {
    const alarms = recurringAlarmsDB.data[side] ?? [];
    for (const alarm of alarms) {
      if (!alarm.enabled) continue;
      const occ = expandAlarmOccurrences(alarm, timeZone, fromMs, toMs);
      for (const o of occ) {
        occurrences.push({
          side,
          alarmId: alarm.id,
          time: alarm.time,
          epochMs: o.epochMs,
          iso: o.iso,
          vibration: alarm.vibration,
          warmRampMinutes: alarm.warmRampMinutes,
          smartWake: alarm.smartWake,
          smartWakeStartMs: alarm.smartWake?.enabled
            ? o.epochMs - alarm.smartWake.windowMinutes * 60 * 1000
            : undefined,
        });
      }
    }
  }

  occurrences.sort((a, b) => a.epochMs - b.epochMs);
  res.json({ hours, timeZone, occurrences });
});

export default router;
