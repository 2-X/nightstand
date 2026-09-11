import express from 'express';
import { SensorSampleSchema, sensorState } from '../8sleep/sensorState.js';
import { prisma } from '../db/prisma.js';
import logger from '../logger.js';

const router = express.Router();
const persisted = new Map<string, number>();
let lastPruned = 0;
let historyError: string | null = null;
router.get('/sensors', async (_req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const vitals = await Promise.all(['left', 'right'].map(async side => {
    const value = await prisma.vitals.findFirst({ where: { side }, orderBy: { timestamp: 'desc' } });
    const fresh = (at: number | null | undefined, maxAge: number) => typeof at === 'number' && at <= now && now - at <= maxAge;
    return { side, at: value?.timestamp ?? null,
      heartRate: value?.heart_rate && fresh(value.timestamp, 120) ? 'live' : 'unavailable',
      hrv: value?.hrv && fresh(value.hrv_timestamp, 90) ? 'live' : 'unavailable',
      breathing: value?.breathing_rate && fresh(value.breathing_timestamp, 30) ? 'live' : 'unavailable',
      hrvAt: value?.hrv_timestamp ?? null, breathingAt: value?.breathing_timestamp ?? null };
  }));
  res.set('Cache-Control', 'private, no-store').json({ samples: sensorState.snapshot(), vitals,
    ready: { left: sensorState.ready('left'), right: sensorState.ready('right') },
    verification: 'Live records verify telemetry only. Buttons, vibration, LEDs, accessories and accuracy require physical tests.',
    historyRetentionDays: 90, historyError });
});
router.get('/sensors/history', async (req, res) => {
  const kind = typeof req.query.kind === 'string' ? req.query.kind : '';
  const start = Number(req.query.start);
  const end = Number(req.query.end);
  if (!sensorState.snapshot().some(sample => sample.kind === kind) || !Number.isFinite(start) || !Number.isFinite(end) ||
      start < 0 || end <= start || end - start > 86400) {
    return res.status(400).json({ error: 'Specify kind and epoch-second start/end covering at most 24 hours.' });
  }
  const samples = await prisma.sensor_samples.findMany({
    where: { kind, timestamp: { gte: Math.floor(start), lte: Math.floor(end) } }, orderBy: { timestamp: 'asc' }, take: 1500,
  });
  return res.set('Cache-Control', 'private, no-store').json(samples.map(sample => ({
    kind: sample.kind, at: sample.timestamp, fields: JSON.parse(sample.fields),
  })));
});
router.post('/sensors', async (req, res) => {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) return res.sendStatus(403);
  const parsed = SensorSampleSchema.safeParse(req.body);
  if (!parsed.success) return res.sendStatus(400);
  const sample = parsed.data;
  if (!sensorState.accept(sample)) return res.sendStatus(409);
  try {
    // At most one source-timestamped sample per minute and kind. No raw waveforms.
    if (sample.at - (persisted.get(sample.kind) ?? 0) >= 60) {
      await prisma.sensor_samples.upsert({ where: { kind_timestamp: { kind: sample.kind, timestamp: Math.floor(sample.at) } },
        create: { kind: sample.kind, timestamp: Math.floor(sample.at), fields: JSON.stringify(sample.fields) }, update: {} });
      persisted.set(sample.kind, sample.at);
      historyError = null;
    }
    if (Date.now() - lastPruned >= 3600000) {
      lastPruned = Date.now();
      await prisma.sensor_samples.deleteMany({ where: { timestamp: { lt: Math.floor(Date.now() / 1000) - 90 * 86400 } } });
    }
    return res.sendStatus(204);
  } catch (error) {
    historyError = 'Sensor history could not be saved.';
    logger.warn(`[sensors] history write failed: ${String(error)}`);
    return res.status(503).json({ error: 'Sensor history unavailable' });
  }
});
export default router;
