import express, { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { parseMetricsQuery, parseRowsQuery, ROWS_QUERY_ERROR } from './metricsQuery.js';
import { prisma } from '../../db/prisma.js';
import { biometricsV2Enabled } from '../../features/biometricsV2.js';
import { averageRespRate, legacyVitalsSelect } from './vitalsV2.js';


const router = express.Router();

router.get('/vitals', async (req: Request, res: Response) => {
  const range = parseRowsQuery(req.query);
  if (!range) return res.status(400).json({ error: ROWS_QUERY_ERROR });
  const query: Prisma.vitalsWhereInput = { side: range.side, timestamp: { gte: range.start, lte: range.end } };

  // With new sleep tracking off the response carries only the columns every
  // release has sent; on, the newer estimate columns come too.
  const vitals = biometricsV2Enabled()
    ? await prisma.vitals.findMany({ where: query, orderBy: { timestamp: 'asc' } })
    : await prisma.vitals.findMany({ where: query, orderBy: { timestamp: 'asc' }, select: legacyVitalsSelect });

  // Timestamps go out as the epoch seconds they are stored as. They used to
  // be reformatted here into an ISO8601 string in the user's timezone, which
  // silently emptied the chart: the client scales the value to milliseconds
  // and discards anything that is not a finite number, so every record was
  // filtered out. Returning the row unchanged keeps one type across the wire,
  // and the client already renders in local time.
  res.json(vitals);
});


router.get('/vitals/summary', async (req: Request, res: Response) => {
  const range = parseMetricsQuery(req.query);
  if (!range) return res.status(400).json({ error: 'Invalid side, startTime or endTime' });
  const query: Prisma.vitalsWhereInput = { side: range.side, timestamp: { gte: range.start, lte: range.end } };

  // Query: Min & Max Heart Rate
  const heartRateSummary = await prisma.vitals.aggregate({
    where: query,
    _min: { heart_rate: true },
    _max: { heart_rate: true },
    _avg: { heart_rate: true },
  });

  // With new sleep tracking on, breathing is the newer estimate only: nights
  // without one show 0 rather than the older estimator's number.
  let avgBreathingRate: number;
  if (biometricsV2Enabled()) {
    avgBreathingRate = await averageRespRate(query);
  } else {
    // Query: Average Breathing Rate (excluding 0)
    const legacyBreathing = await prisma.vitals.aggregate({
      where: {
        ...query,
        breathing_rate: { not: 0, lte: 20, gte: 5 }, // Exclude zero values
      },
      _avg: { breathing_rate: true },
    });
    avgBreathingRate = legacyBreathing._avg.breathing_rate || 0;
  }

  // Query: Average HRV (excluding 0)
  const avgHRV = await prisma.vitals.aggregate({
    where: {
      ...query,
      hrv: { not: 0, lte: 120, gte: 30 }, // Exclude zero values
    },
    _avg: { hrv: true },
  });

  res.json({
    avgHeartRate: Math.round(heartRateSummary._avg.heart_rate || 0),
    minHeartRate: Math.round(heartRateSummary._min.heart_rate || 0),
    maxHeartRate: Math.round(heartRateSummary._max.heart_rate || 0),
    avgHRV: Math.round(avgHRV._avg.hrv || 0),
    avgBreathingRate: Math.round(avgBreathingRate),
  });
});


export default router;
