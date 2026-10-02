import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

// The vitals columns every release has sent. With new sleep tracking off,
// responses carry only these, exactly as before the newer columns existed.
export const legacyVitalsSelect = {
  id: true,
  side: true,
  timestamp: true,
  heart_rate: true,
  hrv: true,
  breathing_rate: true,
} as const;

// Rows carry a breathing rate only when the estimate passed its quality
// check, so the average skips the rest.
export async function averageRespRate(where: Prisma.vitalsWhereInput): Promise<number> {
  const result = await prisma.vitals.aggregate({ where, _avg: { resp_rate: true } });
  return result._avg.resp_rate ?? 0;
}
