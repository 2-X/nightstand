import express, { Request, Response } from 'express';
import { PrismaClient, Prisma, vitals as VitalRecord } from '@prisma/client'; // Import the type
import moment from 'moment-timezone';
import settingsDB from '../../db/settings.js';
import { loadVitals } from '../../db/loadVitals.js';

const prisma = new PrismaClient();
const router = express.Router();

// Define query params
interface VitalsQuery {
  side?: string;
  startTime?: string;
  endTime?: string;
}


router.get('/vitals', async (req: Request<object, object, object, VitalsQuery>, res: Response) => {
  try {
    const { side, startTime, endTime } = req.query;

    // const query: { side?: string; timestamp?: any } = {};
    const query: Prisma.vitalsWhereInput = { timestamp: {} }; // Use Prisma-generated type

    if (side) query.side = side;
    // @ts-ignore
    if (startTime) query.timestamp = { ...query.timestamp, gte: moment(startTime).unix() };
    // @ts-ignore
    if (endTime) query.timestamp = { ...query.timestamp, lte: moment(endTime).unix() };


    // Use Prisma's generated type for the records
    const vitals: VitalRecord[] = await prisma.vitals.findMany({
      where: query,
      orderBy: { timestamp: 'asc' },
    });

    await settingsDB.read();

    const formattedVitals = await loadVitals(vitals);

    res.json(formattedVitals);
  } catch (error) {
    console.error('Error fetching vitals:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
