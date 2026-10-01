import { expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import axios from './api';
import { validateResponse } from './responseValidation';
import { useRhythmsLive } from './rhythms';

let seen: { isSuccess: boolean; data: unknown } | undefined;
function Probe() {
  const query = useRhythmsLive('left');
  seen = { isSuccess: query.isSuccess, data: query.data };
  return null;
}

it('reads no live night as null, while other empty answers still fail', async () => {
  server.use(http.get('*/rhythms/live', () => HttpResponse.json(null)));
  renderWithProviders(<Probe/>);
  await waitFor(() => expect(seen?.isSuccess).toBe(true));
  expect(seen?.data).toBeNull();
  server.use(http.get('*/settings', () => HttpResponse.json(null)));
  await expect(axios.get('/settings')).rejects.toThrow('The server returned an empty response.');
});

it('reads a reason or phase from a newer version as none', () => {
  expect(validateResponse('/rhythms', { status: { enabled: true, active: false, reason: 'future-reason' }, data: null }))
    .toEqual({ status: { enabled: true, active: false }, data: null });
  const live = { side: 'left', date: '2026-09-28', phase: 'future', waiting: false, coolStart: '2026-09-29T05:45:00.000Z',
    hold: null, baseSince: null, nextChange: { at: '2026-09-29T12:56:00.000Z', level: -1, phase: 'future' } };
  expect(validateResponse('/rhythms/live', live)).toEqual({ ...live, phase: null, nextChange: null });
});
