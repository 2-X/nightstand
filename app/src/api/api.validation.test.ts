import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@test/setup';
import api from './api';
import { postDeviceStatus } from './deviceStatus';
import { getDeviceStatus, getSchedules } from '../mocks/mockData';

const mockDeviceStatus = getDeviceStatus();
const mockSchedules = getSchedules();

describe('HTTP data boundaries', () => {
  it.each(['', '<html>Unavailable</html>', '{broken', 'null'])('rejects an invalid successful JSON body: %j', async body => {
    server.use(http.get('*/api/deviceStatus', () => new HttpResponse(body, { headers: { 'Content-Type': 'application/json' } })));
    await expect(api.get('/deviceStatus')).rejects.toThrow();
  });
  it('rejects string temperatures before a control can consume them', async () => {
    server.use(http.get('*/api/deviceStatus',
      () => HttpResponse.json({ ...mockDeviceStatus,
        left: { ...mockDeviceStatus.left,
          targetTemperatureF: '84' } })));
    await expect(api.get('/deviceStatus')).rejects.toThrow();
  });
  it('rejects string schedule temperatures before Turn on can consume them', async () => {
    server.use(http.get('*/api/schedules',
      () => HttpResponse.json({ ...mockSchedules,
        left: { ...mockSchedules.left,
          monday: { ...mockSchedules.left.monday,
            power: { ...mockSchedules.left.monday.power,
              onTemperature: '60' } } } })));
    await expect(api.get('/schedules')).rejects.toThrow();
  });
  it.each([
    '/settings', '/schedules', '/services', '/metrics/sleep', '/logs', '/changelog', '/memory', '/storage', '/serverStatus'
  ])('rejects the wrong shape for %s', async path => {
    server.use(http.get(`*/api${path}`, () => HttpResponse.json({})));
    await expect(api.get(path)).rejects.toThrow();
  });
  it.each([NaN, Infinity, -Infinity, '84'])('refuses unsafe temperature writes: %s', async target => {
    let requests = 0;
    server.use(http.post('*/api/deviceStatus', () => { requests++; return HttpResponse.json({}); }));
    await expect(postDeviceStatus({ left: { targetTemperatureF: target as number } })).rejects.toThrow();
    expect(requests).toBe(0);
  });
});

it('accepts a valid read after a validation failure', async () => {
  server.use(http.get('*/api/deviceStatus', () => HttpResponse.json({}), { once: true }));
  await expect(api.get('/deviceStatus')).rejects.toThrow();
  await expect(api.get('/deviceStatus')).resolves.toMatchObject({ data: { left: { targetTemperatureF: expect.any(Number) } } });
});

it('refuses non-finite scheduled temperatures before sending them', async () => {
  const { postSchedules } = await import('./schedules');
  let writes = 0;
  server.use(http.post('*/api/schedules', () => { writes++; return HttpResponse.json({}); }));
  await expect(postSchedules({ left: { monday: { power: { onTemperature: NaN } } } })).rejects.toThrow();
  expect(writes).toBe(0);
});
