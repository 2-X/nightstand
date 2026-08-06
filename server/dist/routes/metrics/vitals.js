import express from 'express';
import moment from 'moment-timezone';
import { prisma } from '../../db/prisma.js';
const router = express.Router();
router.get('/vitals', async (req, res) => {
    const { side, startTime, endTime } = req.query;
    const query = {};
    if (side)
        query.side = side;
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
    const vitals = await prisma.vitals.findMany({
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
router.get('/vitals/summary', async (req, res) => {
    const { side, startTime, endTime } = req.query;
    const query = {};
    if (side)
        query.side = side;
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
            breathing_rate: { not: 0, lte: 20, gte: 5 }, // Exclude zero values
        },
        _avg: { breathing_rate: true },
    });
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
        avgBreathingRate: Math.round(avgBreathingRate._avg.breathing_rate || 0),
    });
});
export default router;
//# sourceMappingURL=vitals.js.map