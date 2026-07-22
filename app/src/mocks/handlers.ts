import { http, HttpResponse, delay } from 'msw';
import type { SleepRecord } from '@api/sleepSchema.ts';
import type { Jobs } from '@api/jobs.ts';
import type { BasePosition } from '@api/baseControl.ts';
import {
  getServices,
  updateServices,
  getSchedules,
  updateSchedules,
  getSettings,
  updateSettings,
  getDeviceStatus,
  updateDeviceStatus,
  getServerStatus,
  getStorageInfo,
  getMemoryInfo,
  getBaseStatus,
  setBasePosition,
  setBasePreset,
  stopBase,
  listSleepRecords,
  setSleepRecords,
  listMovementRecords,
  listVitalsRecords,
  getSleepStages,
  getSleepScore,
  filterByQuery,
  listLogs,
  getLogFiles,
  getChangelog,
  handleJobs,
  releasesManifest,
  remoteServerInfo,
  remoteChangelogMarkdown,
  rollbackInfo,
} from './mockData';

type Side = 'left' | 'right';

type Filters = {
  startTime?: string;
  endTime?: string;
  side?: Side;
};

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const toFilters = (request: Request): Filters => {
  const url = new URL(request.url);
  const startTime = url.searchParams.get('startTime') ?? undefined;
  const endTime = url.searchParams.get('endTime') ?? undefined;
  const sideParam = url.searchParams.get('side') ?? undefined;
  const side = sideParam === 'left' || sideParam === 'right' ? sideParam : undefined;
  return { startTime, endTime, side };
};

const notFound = (message: string) => HttpResponse.json({ message }, { status: 404 });

export const handlers = [
  http.get('/api/services', async () => {
    await delay(120);
    return HttpResponse.json(deepClone(getServices()));
  }),
  http.post('/api/services', async ({ request }) => {
    const body = (await request.json()) as Partial<ReturnType<typeof getServices>>;
    const updated = updateServices(body);
    await delay(120);
    return HttpResponse.json(deepClone(updated));
  }),
  http.get('/api/schedules', async () => {
    await delay(120);
    return HttpResponse.json(deepClone(getSchedules()));
  }),
  http.post('/api/schedules', async ({ request }) => {
    const body = (await request.json()) as Partial<ReturnType<typeof getSchedules>>;
    const updated = updateSchedules(body);
    await delay(120);
    return HttpResponse.json(deepClone(updated));
  }),
  http.get('/api/settings', async () => {
    await delay(120);
    return HttpResponse.json(deepClone(getSettings()));
  }),
  http.post('/api/settings', async ({ request }) => {
    const body = (await request.json()) as Partial<ReturnType<typeof getSettings>>;
    const updated = updateSettings(body);
    await delay(120);
    return HttpResponse.json(deepClone(updated));
  }),
  http.get('/api/deviceStatus', async () => {
    await delay(120);
    return HttpResponse.json(deepClone(getDeviceStatus()));
  }),
  http.post('/api/deviceStatus', async ({ request }) => {
    const body = (await request.json()) as Partial<ReturnType<typeof getDeviceStatus>>;
    updateDeviceStatus(body);
    await delay(120);
    return new HttpResponse(null, { status: 204 });
  }),
  http.get('/api/serverStatus', async () => {
    await delay(150);
    return HttpResponse.json(deepClone(getServerStatus()));
  }),
  http.get('/api/storage', async () => {
    await delay(150);
    return HttpResponse.json(deepClone(getStorageInfo()));
  }),
  http.get('/api/memory', async () => {
    await delay(150);
    return HttpResponse.json(deepClone(getMemoryInfo()));
  }),
  http.get('/api/changelog', async () => {
    await delay(150);
    return HttpResponse.json({ entries: deepClone(getChangelog()) });
  }),
  http.get('/api/update/rollback-info', () => HttpResponse.json(rollbackInfo)),
  http.post('/api/update', () => new HttpResponse(null, { status: 204 })),
  http.get('/api/base-control', async () => {
    await delay(100);
    return HttpResponse.json(deepClone(getBaseStatus()));
  }),
  http.post('/api/base-control', async ({ request }) => {
    const body = (await request.json()) as BasePosition;
    await delay(100);
    return HttpResponse.json(deepClone(setBasePosition(body)));
  }),
  http.post('/api/base-control/preset', async ({ request }) => {
    const body = (await request.json()) as { preset: string };
    await delay(100);
    return HttpResponse.json(deepClone(setBasePreset(body.preset)));
  }),
  http.post('/api/base-control/stop', async () => {
    await delay(100);
    return HttpResponse.json(deepClone(stopBase()));
  }),
  http.get('/api/metrics/sleep-stages', async ({ request }) => {
    const { startTime, endTime } = toFilters(request);
    await delay(150);
    if (!startTime || !endTime) {
      return HttpResponse.json({
        epochs: [],
        totals: { awake: 0, rem: 0, light: 0, deep: 0 },
        percentages: { awake: 0, rem: 0, light: 0, deep: 0 },
        totalSeconds: 0,
      });
    }
    return HttpResponse.json(getSleepStages(startTime, endTime));
  }),
  http.get('/api/metrics/sleep-score', async ({ request }) => {
    const { startTime, endTime } = toFilters(request);
    await delay(150);
    if (!startTime || !endTime) {
      return HttpResponse.json({
        score: 0,
        components: {
          duration: { score: 0, weight: 0.35, value: '', available: false },
          continuity: { score: 0, weight: 0.25, value: '', available: false },
          hrv: { score: 0, weight: 0.2, value: '', available: false },
          restingHr: { score: 0, weight: 0.2, value: '', available: false },
        },
      });
    }
    return HttpResponse.json(getSleepScore(startTime, endTime));
  }),
  http.get('/api/metrics/sleep', async ({ request }) => {
    const filters = toFilters(request);
    const records = listSleepRecords();
    // @ts-expect-error
    const filtered = filterByQuery(records, filters, (record: SleepRecord) => Date.parse(record.entered_bed_at));
    await delay(150);
    return HttpResponse.json(deepClone(filtered));
  }),
  http.delete('/api/metrics/sleep/:id', async ({ params }) => {
    const id = Number(params.id);
    const records = listSleepRecords();
    const next = records.filter((record) => record.id !== id);
    if (next.length === records.length) {
      return notFound('Sleep record not found');
    }
    setSleepRecords(next);
    await delay(80);
    return new HttpResponse(null, { status: 204 });
  }),
  http.put('/api/metrics/sleep/:id', async ({ params, request }) => {
    const id = Number(params.id);
    const updates = (await request.json()) as Partial<SleepRecord>;
    const records = deepClone(listSleepRecords());
    const index = records.findIndex((record) => record.id === id);
    if (index === -1) {
      return notFound('Sleep record not found');
    }
    const updatedRecord = { ...records[index], ...updates } satisfies SleepRecord;
    records[index] = updatedRecord;
    setSleepRecords(records);
    await delay(80);
    return HttpResponse.json(updatedRecord);
  }),
  http.get('/api/metrics/movement', async () => {
    // const filters = toFilters(request);
    const records = listMovementRecords();
    // const filtered = filterByQuery(records, filters, (record: MovementRecord) => record.timestamp * 1000);
    await delay(120);
    return HttpResponse.json(records);
  }),
  http.get('/api/metrics/vitals', async () => {
    // const filters = toFilters(request);
    const records = listVitalsRecords();
    // const filtered = filterByQuery(records, filters, (record: VitalsRecord) => record.timestamp * 1000);
    await delay(120);
    return HttpResponse.json(records);
  }),
  http.get('/api/metrics/vitals/summary', async () => {
    await delay(120);
    return HttpResponse.json({
      avgHeartRate: 55,
      minHeartRate: 45,
      maxHeartRate: 68,
      avgHRV: 63,
      avgBreathingRate: 12,
    });
  }),
  http.post('/api/jobs', async ({ request }) => {
    const jobs = (await request.json()) as Jobs;
    handleJobs(jobs);
    await delay(150);
    return new HttpResponse(null, { status: 204 });
  }),
  http.get('/api/logs', async () => {
    await delay(120);
    return HttpResponse.json({ logs: getLogFiles() });
  }),
  http.get('/api/logs/:filename', ({ params }) => {
    const filename = params.filename as string;
    const logStore = listLogs();
    const initialLogs = deepClone(logStore[filename] ?? []);
    if (!logStore[filename]) {

      // @ts-expect-error
      return HttpResponse.eventStream({
        // @ts-expect-error
        open(controller) {
          controller.send({ data: JSON.stringify({ message: 'Log file not found' }) });
          controller.close();
        },
      });
    }

    // @ts-expect-error
    return HttpResponse.eventStream({
      headers: {
        'Cache-Control': 'no-cache',
      },
      // @ts-expect-error
      open(controller) {
        initialLogs.forEach((entry) => {
          controller.send({ data: JSON.stringify({ message: entry }) });
        });
        let lastIndex = initialLogs.length;
        const interval = setInterval(() => {
          const latest = listLogs()[filename] ?? [];
          if (latest.length > lastIndex) {
            latest.slice(lastIndex).forEach((entry) => {
              controller.send({ data: JSON.stringify({ message: entry }) });
            });
            lastIndex = latest.length;
          }
        }, 2000);

        return () => clearInterval(interval);
      },
    });
  }),

  // The pod has no WAN, so these three files only ever resolve in the browser;
  // mocking them keeps the demo and the tests offline and deterministic.
  http.get('https://raw.githubusercontent.com/LTimothy/nightstand/main/releases.json', () =>
    HttpResponse.json(releasesManifest)),
  http.get('https://raw.githubusercontent.com/LTimothy/nightstand/main/server/src/serverInfo.json', () =>
    HttpResponse.json(remoteServerInfo)),
  http.get('https://raw.githubusercontent.com/LTimothy/nightstand/main/CHANGELOG.md', () =>
    HttpResponse.text(remoteChangelogMarkdown)),
];

