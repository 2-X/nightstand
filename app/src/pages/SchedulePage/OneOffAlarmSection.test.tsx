import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import OneOffAlarmSection from './OneOffAlarmSection';

describe('OneOffAlarmSection', () => {
  it('posts the one-off alarm to the left side on save', async () => {
    let posted: any;
    server.use(
      http.post('*/settings', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({});
      }),
    );

    const { user } = renderWithProviders(<OneOffAlarmSection />, { initialRoute: '/schedules' });

    // The section renders its heading once settings load.
    expect(await screen.findByText('One-off alarm')).toBeInTheDocument();

    const save = await screen.findByRole('button', { name: 'Save one-off alarm' });
    await user.click(save);

    await waitFor(() => expect(posted).toBeTruthy());
    expect(posted.left).toBeTruthy();
    expect(posted.left.oneOffAlarm).toBeTruthy();
    // Default mock state is disabled; the payload carries the full shape.
    expect(posted.left.oneOffAlarm).toHaveProperty('enabled');
    expect(posted.left.oneOffAlarm).toHaveProperty('vibrationPattern');
    expect(posted.left.oneOffAlarm).toHaveProperty('duration');
  });
});
