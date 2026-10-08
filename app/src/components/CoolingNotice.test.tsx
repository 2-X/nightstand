import { expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { getSettings } from '../mocks/mockData';
import CoolingNotice from './CoolingNotice';

it('acknowledges only the selected side and keeps the status finding active', async () => {
  let acknowledged: unknown;
  const finding = { active: true, notice: true, since: 100, message: 'Water is warming while cooling is requested' };
  server.use(
    http.get('*/api/settings', () => HttpResponse.json({ ...getSettings(), features: { ...getSettings().features, coolingWarning: true } })),
    http.get('*/api/services/firmware', () => HttpResponse.json({ availability: 'Monitoring active', targets: {}, taps: [], incidents: [],
      sensorFresh: true, interrupted: false, cooling: { left: { ...finding, notice: !acknowledged },
        right: { active: false, notice: false, message: finding.message } } })),
    http.post('*/api/services/firmware/cooling/acknowledge', async ({ request }) => {
      acknowledged = await request.json();
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const { user, queryClient } = renderWithProviders(<CoolingNotice />);
  expect(await screen.findByRole('dialog')).toHaveTextContent('Water is warming while cooling is requested');
  await user.click(screen.getByRole('button', { name: 'Acknowledge' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(acknowledged).toEqual({ side: 'left', since: 100 });
  expect(queryClient.getQueryData<{ cooling: { left: { active: boolean } } }>(['firmware'])?.cooling.left.active).toBe(true);
});
