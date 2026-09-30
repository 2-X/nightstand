import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import OneOffAlarmSection from './OneOffAlarmSection';
import { getSettings } from '../../mocks/mockData';

describe('OneOffAlarmSection', () => {
  it('posts the one-time alarm to the left side on save', async () => {
    let posted: any;
    server.use(
      http.post('*/settings', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({});
      }),
    );

    const { user } = renderWithProviders(<OneOffAlarmSection />, { initialRoute: '/schedules' });

    // The section renders its heading once settings load.
    expect(await screen.findByText(/Rings once for/)).toHaveTextContent('Rings once for Alex');

    const save = await screen.findByRole('button', { name: 'Save one-time alarm' });
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

it('offers whole-second lengths, labels strength and shows the friendly Pod timezone', async () => {
  renderWithProviders(<OneOffAlarmSection/>);
  fireEvent.click(await screen.findByRole('switch', { name: 'Enable one-time alarm' }));
  expect(screen.getByRole('slider', { name: /Strength/ })).toBeInTheDocument();
  expect(screen.getByText(/Timezone: Pacific Time/)).toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Length' }));
  expect(screen.getByRole('option', { name: '3 minutes' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: '4 minutes' })).not.toBeInTheDocument();
  expect(screen.queryByRole('spinbutton', { name: 'Length' })).not.toBeInTheDocument();
});

it('reads and saves times in UTC while the Pod has no time zone set', async () => {
  let posted: any;
  server.use(
    http.get('*/settings', () => HttpResponse.json({ ...getSettings(), timeZone: null })),
    http.post('*/settings', async ({ request }) => { posted = await request.json(); return HttpResponse.json({}); }),
  );
  renderWithProviders(<OneOffAlarmSection/>);
  fireEvent.click(await screen.findByRole('switch', { name: 'Enable one-time alarm' }));
  fireEvent.change(screen.getByLabelText('Ring at'), { target: { value: '2099-01-02T07:30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save one-time alarm' }));
  await waitFor(() => expect(posted).toBeTruthy());
  expect(posted.left.oneOffAlarm.fireAt).toBe('2099-01-02T07:30:00Z');
});
