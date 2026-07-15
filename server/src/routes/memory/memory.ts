import express, { Request, Response } from 'express';
import fs from 'fs';
import os from 'os';
import logger from '../../logger.js';
import { parseMeminfo } from './parseMeminfo.js';
import { MemoryInfo } from './memorySchema.js';

const router = express.Router();

async function readMemory(): Promise<{ totalBytes: number; availableBytes: number }> {
  try {
    const text = await fs.promises.readFile('/proc/meminfo', 'utf8');
    const parsed = parseMeminfo(text);
    if (parsed) {
      return { totalBytes: parsed.totalKb * 1024, availableBytes: parsed.availableKb * 1024 };
    }
  } catch {
    // /proc/meminfo doesn't exist off-Linux (e.g. local Mac dev), so fall
    // through to the cross-platform os.* APIs below.
  }
  // os.freemem() doesn't account for reclaimable cache the way
  // MemAvailable does, but it's the best cross-platform approximation.
  return { totalBytes: os.totalmem(), availableBytes: os.freemem() };
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const { totalBytes, availableBytes } = await readMemory();
    const usedBytes = totalBytes - availableBytes;

    const info: MemoryInfo = {
      totalBytes,
      usedBytes,
      availableBytes,
      usedPercent: Math.round((usedBytes / totalBytes) * 1000) / 10,
    };

    res.json(info);
  } catch (error) {
    logger.error('Failed to read memory usage', error);
    res.status(500).json({ message: 'Unable to read memory usage' });
  }
});

export default router;
