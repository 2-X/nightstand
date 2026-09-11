import express, { Request, Response } from 'express';
import { Prisma, vitals as VitalRecord } from '@prisma/client';
import moment from 'moment-timezone';
import { prisma } from '../../db/prisma.js';


const router = express.Router();

// Define query params
interface VitalsQuery {
  side?: string;
  startTime?: string;
  endTime?: string;
}


router.get('/vitals', async (req: Request<object, object, object, VitalsQuery>, res: Response) => {
  const { side, startTime, endTime } = req.query;
  const query: Prisma.vitalsWhereInput = {};

  if (side) query.side = side;

  query.timestamp = {};
  if (startTime) {
    // @ts-ignore
    query.timestamp.gte = moment(startTime).unix();
  }
  if (endTime) {
    // @ts-ignore
    query.timestamp.lte = moment(endTime).unix();
  }


  // Use Prisma's generated type for the records
  const vitals: VitalRecord[] = await prisma.vitals.findMany({
    where: query,
    orderBy: { timestamp: 'asc' },
  });

  // Timestamps go out as the epoch seconds they are stored as. They used to
  // be reformatted here into an ISO8601 string in the user's timezone, which
  // silently emptied the chart: the client scales the value to milliseconds
  // and discards anything that is not a finite number, so every record was
  // filtered out. Returning the row unchanged keeps one type across the wire,
  // and the client already renders in local time.
  res.json(vitals);
});


router.get('/vitals/summary', async (req: Request<object, object, object, VitalsQuery>, res: Response) => {
  const { side, startTime, endTime } = req.query;

  const query: Prisma.vitalsWhereInput = {};

  if (side) query.side = side;

  query.timestamp = {};
  if (startTime) {
    // @ts-ignore
    query.timestamp.gte = moment(startTime).unix();
  }
  if (endTime) {
    // @ts-ignore
    query.timestamp.lte = moment(endTime).unix();
  }

  // Query: Min & Max Heart Rate
  const heartRateSummary = await prisma.vitals.aggregate({
    where: query,
    _min: { heart_rate: true },
    _max: { heart_rate: true },
    _avg: { heart_rate: true },
  });

  // Query: Average Breathing Rate (excluding 0)
  const avgBreathingRate = await prisma.vitals.aggregate({
    where: {
      ...query,
      breathing_rate: { gt: 0 }, // Exclude zero values
    },
    _avg: { breathing_rate: true },
  });

  // Query: Average HRV (excluding 0)
  const avgHRV = await prisma.vitals.aggregate({
    where: {
      ...query,
      hrv: { gt: 0 }, // Exclude zero values
    },
    _avg: { hrv: true },
  });

  const rounded = (value: number | null) => value === null ? null : Math.round(value);
  res.json({
    avgHeartRate: rounded(heartRateSummary._avg.heart_rate),
    minHeartRate: rounded(heartRateSummary._min.heart_rate),
    maxHeartRate: rounded(heartRateSummary._max.heart_rate),
    avgHRV: rounded(avgHRV._avg.hrv),
    avgBreathingRate: rounded(avgBreathingRate._avg.breathing_rate),
  });
});


export default router;
