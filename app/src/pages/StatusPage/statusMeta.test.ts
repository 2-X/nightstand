import { expect, it } from 'vitest';
import { getServerStatus } from '../../mocks/mockData';
import { CORE_KEYS, STATUS_META, coreServicesReady, overdueCoreKeys } from './statusMeta';

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


it('requires every core service in the metadata to be ready', () => {
  expect(CORE_KEYS).toEqual(Object.keys(STATUS_META).filter(key => STATUS_META[key as keyof typeof STATUS_META].group === 'core'));
  const data = getServerStatus();
  expect(coreServicesReady(data)).toBe(true);
  expect(coreServicesReady({ ...data, pumpHealthLeft: { ...data.pumpHealthLeft!, status: 'not_started' } })).toBe(false);
});
