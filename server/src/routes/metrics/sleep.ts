import express, { Request, Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import moment from 'moment-timezone';
import { sleepRecordSchema, SleepRecord } from '../../db/sleepRecordsSchema.js';
import { loadSleepRecords } from '../../db/loadSleepRecords.js';
const prisma = new PrismaClient();

const router = express.Router();

// Define query params
interface SleepQuery {
  side?: string;
  startTime?: string;
  endTime?: string;
}


router.get('/sleep', async (req: Request<object, object, object, SleepQuery>, res: Response) => {
  try {
    const { startTime, endTime, side } = req.query;
    const query: Prisma.sleep_recordsWhereInput = {
      entered_bed_at: {},
      left_bed_at: {},
    };

    if (side) query.side = side;
    if (startTime) { // @ts-ignore
      query.left_bed_at!.gte = moment(startTime).unix();
    }
    if (endTime) { // @ts-ignore
      query.entered_bed_at!.lte = moment(endTime).unix();
    }

    const sleepRecords = await prisma.sleep_records.findMany({
      where: query,
      orderBy: { entered_bed_at: "asc" },
    });

    const formattedRecords = await loadSleepRecords(sleepRecords);
    res.json(formattedRecords);
  } catch (error) {
    console.error('Error in GET /sleep:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


router.put('/sleep/:id', async (req: Request<{ id: string }, object, Partial<SleepRecord>>, res: Response<SleepRecord | { error: string }>) => {


  try {
    const { id } = req.params;
    const parsedId = parseInt(id, 10);
    if (isNaN(parsedId)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    // Validate the request body against the schema
    const parsedData = sleepRecordSchema.partial().safeParse(req.body);
    if (!parsedData.success) {
      return res.status(400).json({ error: 'Invalid request body', details: parsedData.error.format() });
    }

    // Convert entered_bed_at and exited_bed_at to epoch (Unix timestamp)
    const data = { ...parsedData.data };
    if (data.entered_bed_at) {
      // @ts-ignore
      data.entered_bed_at = Math.floor(new Date(data.entered_bed_at).getTime() / 1000);
    }
    if (data.left_bed_at) {
      // @ts-ignore
      data.left_bed_at = Math.floor(new Date(data.left_bed_at).getTime() / 1000);
    }

    // Recalculate sleep_period_seconds if both timestamps exist
    if (data.entered_bed_at && data.left_bed_at) {
      // @ts-ignore
      data.sleep_period_seconds = data.left_bed_at - data.entered_bed_at;
    }

    // Update the record in the database
    const updatedRecord = await prisma.sleep_records.update({
      where: { id: parsedId },
      // @ts-ignore
      data,
    });
    const loadedNewRecord = await loadSleepRecords([updatedRecord]);
    return res.json(loadedNewRecord[0]);
  } catch (error) {
    console.error('Error updating sleep record:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


router.delete('/sleep/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.sleep_records.delete({ where: { id: parseInt(id, 10) } });
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting record:', error);
    res.status(500).json({ error: 'Failed to delete record' });
  }
});


export default router;
