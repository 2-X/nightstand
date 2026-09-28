import { expect, it } from 'vitest';
import { getServerStatus } from '../../mocks/mockData';
import { overdueCoreKeys } from './statusMeta';

it('uses the server start time and waits two minutes before warning', () => {
  const data = getServerStatus();
  const startedAt = Date.parse('2026-09-28T12:00:00Z');
  const status = {
    ...data,
    express: { ...data.express, timestamp: new Date(startedAt).toISOString() },
    frankenMonitor: { ...data.frankenMonitor, status: 'not_started' as const },
  };
  expect(overdueCoreKeys(status, startedAt + 119_999)).toEqual([]);
  expect(overdueCoreKeys(status, startedAt + 120_000)).toEqual(['frankenMonitor']);
  expect(overdueCoreKeys({ ...status, express: { ...status.express, timestamp: undefined } }, startedAt + 180_000)).toEqual([]);
});
