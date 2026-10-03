import express, { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import settingsDB from '../../db/settings.js';
import servicesDB from '../../db/services.js';
import { isSleepScoreActive } from './sleepScoreGuard.js';
import { parseNightQuery } from './metricsQuery.js';
import { loadStageSummary, StageSummary } from './sleepStages.js';

const router = express.Router();

type Component = {
  score: number; // 0-100
  weight: number; // sum of present component weights = 1
  value: string; // human-readable original value
  available: boolean;
};

// --- Component scorers (each returns 0-100) ---

function scoreDuration(seconds: number): number {
  const hours = seconds / 3600;
  // 8h = 100, falls ~10pts per hour away, floor at 0
  const delta = Math.abs(hours - 8);
  return Math.max(0, Math.round(100 - delta * 10));
}

function scoreContinuity(timesExited: number): number {
  // 0 exits = 100, -15 per exit, floor at 0
  return Math.max(0, 100 - timesExited * 15);
}

function scoreRestingHr(minHr: number): number {
  // Lower min HR during sleep = deeper rest
  if (minHr === 0) return 0;
  if (minHr < 55) return 95;
  if (minHr < 65) return 85;
  if (minHr < 75) return 70;
  if (minHr < 85) return 55;
  return 40;
}

function formatHours(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h${m ? ` ${m}m` : ''}`;
}

// Scores the same asleep time the stages headline shows, or time in bed when
// vitals coverage is too sparse for the stages to say when sleep began.
export function durationComponent(inBedSeconds: number, stages: StageSummary): Component {
  const [seconds, label] = stages.lowCoverage ? [inBedSeconds, 'in bed'] : [stages.asleepSeconds, 'asleep'];
  return {
    score: scoreDuration(seconds),
    weight: 0.4,
    value: `${formatHours(seconds)} ${label}`,
    available: true,
  };
}

router.get(
  '/sleep-score',
  async (req: Request, res: Response) => {
    const night = parseNightQuery(req.query);
    if (!night) {
      return res.status(400).json({ error: 'side, startTime and endTime are required, and the range must be at most 48 hours' });
    }
    const { side, start: startUnix, end: endUnix } = night;

    await settingsDB.read();
    await servicesDB.read();
    if (!isSleepScoreActive(settingsDB.data, servicesDB.data)) {
      return res.json({ active: false, score: null, components: {} });
    }


    // Sleep record covering this window (used for duration + bed exits)
    const sleepRecord = await prisma.sleep_records.findFirst({
      where: {
        side,
        entered_bed_at: { lte: startUnix + 60 },
        left_bed_at: { gte: endUnix - 60 },
      },
      orderBy: { entered_bed_at: 'asc' },
    });

    // Vitals during the window
    const vitalsQuery: Prisma.vitalsWhereInput = {
      side,
      timestamp: { gte: startUnix, lte: endUnix },
    };
    const hrAgg = await prisma.vitals.aggregate({
      where: vitalsQuery,
      _min: { heart_rate: true },
    });

    const inBedSec = sleepRecord?.sleep_period_seconds ?? endUnix - startUnix;
    const stages = await loadStageSummary(side, startUnix, endUnix);
    const exits = sleepRecord?.times_exited_bed ?? 0;
    const minHr = hrAgg._min.heart_rate ?? 0;

    const components: Record<string, Component> = {
      duration: durationComponent(inBedSec, stages),
      continuity: {
        score: scoreContinuity(exits),
        weight: 0.3,
        value: `${exits} ${exits === 1 ? 'exit' : 'exits'}`,
        available: true,
      },
      // Kept in the response for older apps. The estimate is not used in the
      // score, so its weight goes to the other components.
      hrv: { score: 0, weight: 0.15, value: '', available: false },
      restingHr: {
        score: scoreRestingHr(minHr),
        weight: 0.15,
        value: minHr > 0 ? `${Math.round(minHr)} bpm` : '\u2014',
        available: minHr > 0,
      },
    };

    // Reweight: distribute missing components' weight proportionally across present ones.
    const totalAvailableWeight = Object.values(components)
      .filter((c) => c.available)
      .reduce((acc, c) => acc + c.weight, 0);

    let weightedSum = 0;
    for (const c of Object.values(components)) {
      if (!c.available) continue;
      const adjustedWeight = c.weight / totalAvailableWeight;
      weightedSum += c.score * adjustedWeight;
    }

    const score = Math.round(weightedSum);

    return res.json({ active: true, score, components });
  },
);

export default router;
