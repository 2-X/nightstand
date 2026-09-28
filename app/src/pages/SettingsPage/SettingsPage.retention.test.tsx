import { expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { getServices, getSettings } from '../../mocks/mockData';
import SettingsPage from './SettingsPage';

it.each(['off', 'unavailable'])('keeps retention editable when biometrics is %s', async (state) => {
  let saved: unknown;
  server.use(
    http.get('*/services', () => state === 'unavailable' ? new HttpResponse(null, { status: 503 })
      : HttpResponse.json({ ...getServices(), biometrics: { ...getServices().biometrics, enabled: false } })),
    http.post('*/settings', async ({ request }) => {
      saved = await request.json();
      return HttpResponse.json({ ...getSettings(), rawArchiveRetentionDays: 2 });
    }),
  );
  const { user } = renderWithProviders(<SettingsPage/>, { initialRoute: '/settings/features' });
  const select = await screen.findByRole('combobox', { name: 'Keep raw sensor recordings' });
  await waitFor(() => expect(select).not.toHaveAttribute('aria-disabled', 'true'));
  await user.click(select);
  await user.click(await screen.findByRole('option', { name: '2 days' }));
  await waitFor(() => expect(saved).toEqual({ rawArchiveRetentionDays: 2 }));
});
