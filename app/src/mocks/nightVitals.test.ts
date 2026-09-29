import { expect, it } from 'vitest';
import { listSleepRecords } from './mockData';
import type { VitalsRecord } from '@api/vitals';

it('serves each demo night with measurements from its own side and recorded window', async () => {
  for (const night of listSleepRecords()) {
    const query = new URLSearchParams({
      side: night.side, startTime: night.entered_bed_at, endTime: night.left_bed_at,
    });
    const response = await fetch(`/api/metrics/vitals?${query}`);
    const records = await response.json() as VitalsRecord[];
    expect(records.length).toBeGreaterThan(10);
    for (const record of records) {
      expect(record.side).toBe(night.side);
      expect(record.timestamp * 1000).toBeGreaterThanOrEqual(Date.parse(night.entered_bed_at));
      expect(record.timestamp * 1000).toBeLessThanOrEqual(Date.parse(night.left_bed_at));
    }
  }
});
