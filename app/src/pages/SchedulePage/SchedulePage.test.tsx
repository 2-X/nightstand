import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import SchedulePage from './SchedulePage';

describe('SchedulePage', () => {
  it('renders the schedule page once schedule data loads', async () => {
    renderWithProviders(<SchedulePage />, { initialRoute: '/schedules' });
    expect(await screen.findByText('Power on')).toBeInTheDocument();
  });
});
