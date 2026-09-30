import { beforeEach, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { useAppStore } from '@state/appStore';
import { useScheduleStore } from './scheduleStore';
import { getSettings } from '../../mocks/mockData';
import SchedulePage from './SchedulePage';

beforeEach(() => {
  useAppStore.setState({ side: 'left', isUpdating: false });
  useScheduleStore.setState(useScheduleStore.getInitialState(), true);
});

it('shows the paused notice above the night and resumes from it', async () => {
  const settings = structuredClone(getSettings());
  settings.left.scheduleOverrides.pause = { active: true, expiresAt: '' };
  let posted: unknown;
  server.use(
    http.get('*/settings', () => HttpResponse.json(settings)),
    http.post('*/settings', async ({ request }) => {
      posted = await request.json();
      settings.left.scheduleOverrides.pause = { active: false, expiresAt: '' };
      return HttpResponse.json(settings);
    }),
  );
  const { user } = renderWithProviders(<SchedulePage/>, { initialRoute: '/schedules' });
  expect(await screen.findByText('Schedule paused until you resume')).toBeInTheDocument();
  expect(screen.getByText('Changes you save apply after the pause.')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Bedtime' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Resume schedule' }));
  await waitFor(() => expect(posted).toEqual({ left: { scheduleOverrides: { pause: { active: false, expiresAt: '' } } } }));
  await waitFor(() => expect(screen.queryByText('Schedule paused until you resume')).not.toBeInTheDocument());
  // The Resume button is gone, so focus moves to the night heading, as after a save.
  await waitFor(() => expect(document.activeElement).toBe(document.getElementById('schedule-night-heading')), { timeout: 3000 });
});

it('does not show the partner\'s pause on this side', async () => {
  const settings = structuredClone(getSettings());
  settings.right.scheduleOverrides.pause = { active: true, expiresAt: '' };
  server.use(http.get('*/settings', () => HttpResponse.json(settings)));
  renderWithProviders(<SchedulePage/>, { initialRoute: '/schedules' });
  await screen.findByRole('heading', { name: 'Bedtime' });
  expect(screen.queryByText(/Schedule paused/)).not.toBeInTheDocument();
});
