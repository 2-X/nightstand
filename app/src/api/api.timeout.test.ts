import { afterEach, describe, expect, it, vi } from 'vitest';
import api, { HARDWARE_REQUEST_TIMEOUT_MS, LONG_REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MS, SERVICES_REQUEST_TIMEOUT_MS } from './api';
import { postJobs } from './jobs';
import { postDeviceStatus } from './deviceStatus';
import { postAlarm } from './alarm';
import { postServices } from './services';
import { postSwitchToUpstream, postRollback, postUpdate } from './update';
import { sleepStagesQueryOptions } from './sleepStages';
import targetFixtures from '../../../scripts/tests/fixtures/upstream_targets.json';

afterEach(() => vi.restoreAllMocks());

describe('request timeouts', () => {
  it('gives every request a finite timeout so a stalled one errors instead of spinning', () => {
    expect(api.defaults.timeout).toBe(REQUEST_TIMEOUT_MS);
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it.each([
    ['jobs', () => postJobs(['analyzeSleepLeft'])],
    ['update', () => postUpdate()],
    ['rollback', () => postRollback()],
    ['switch to upstream', () => postSwitchToUpstream({ target: targetFixtures[1].expected! })],
  ])('lets the %s request run longer than the default', async (_name, send) => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: undefined });
    await send();
    expect(post.mock.calls[0]?.[2]?.timeout).toBe(LONG_REQUEST_TIMEOUT_MS);
    expect(LONG_REQUEST_TIMEOUT_MS).toBeGreaterThan(REQUEST_TIMEOUT_MS);
  });

  it.each([
    ['device status', () => postDeviceStatus({ left: { isOn: true } })],
    ['alarm test', () => postAlarm({ side: 'left', vibrationIntensity: 1, vibrationPattern: 'rise', duration: 10, force: true })],
  ])('waits longer than the server does for a %s command, and reads keep the default', async (_name, send) => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: undefined });
    await send();
    expect(post.mock.calls[0]?.[2]?.timeout).toBe(HARDWARE_REQUEST_TIMEOUT_MS);
    // 10 s connect wait, then 15 s for each of the two commands Turn on sends.
    expect(HARDWARE_REQUEST_TIMEOUT_MS).toBeGreaterThan(10_000 + 2 * 15_000);
    expect(api.defaults.timeout).toBe(REQUEST_TIMEOUT_MS);
  });

  it('waits longer than the server does for a biometrics stop, so a slow one is not reported as failed', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: undefined });
    await postServices({ biometrics: { enabled: false } });
    expect(post.mock.calls[0]?.[2]?.timeout).toBe(SERVICES_REQUEST_TIMEOUT_MS);
    expect(SERVICES_REQUEST_TIMEOUT_MS).toBeGreaterThan(120_000);
  });

  it('lets on-demand sleep stages run longer than the default', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: {} });
    const options = sleepStagesQueryOptions({ side: 'left', startTime: 'a', endTime: 'b' });
    await (options.queryFn as (context: { signal: AbortSignal }) => Promise<unknown>)({ signal: new AbortController().signal });
    expect(get.mock.calls[0]?.[1]?.timeout).toBe(LONG_REQUEST_TIMEOUT_MS);
  });
});
