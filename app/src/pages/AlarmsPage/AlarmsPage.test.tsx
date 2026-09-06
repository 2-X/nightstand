import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import AlarmsPage from './AlarmsPage';

// The demo mock seeds the left side with a weekdays 07:00 alarm and a weekends
// 09:00 alarm (see mocks/mockData.ts). The default selected side is 'left'.
describe('AlarmsPage', () => {
  it('renders the seeded alarms with cadence chips', async () => {
    renderWithProviders(<AlarmsPage />, { initialRoute: '/alarms' });
    // Times render in 12h format.
    expect(await screen.findByText('7:00 AM', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('9:00 AM')).toBeInTheDocument();
    // Cadence chips.
    expect(screen.getByText('Mon–Fri')).toBeInTheDocument();
    expect(screen.getByText('Sat–Sun')).toBeInTheDocument();
  });

  it('opens the editor when Add is pressed', async () => {
    const { user } = renderWithProviders(<AlarmsPage />, { initialRoute: '/alarms' });
    await screen.findByText('7:00 AM', {}, { timeout: 5000 });
    await user.click(screen.getByRole('button', { name: /add/i }));
    await waitFor(() => expect(screen.getByText('New alarm')).toBeInTheDocument());
    // The recurrence selector defaults to Every day.
    expect(screen.getByText('Every day')).toBeInTheDocument();
  });
});
