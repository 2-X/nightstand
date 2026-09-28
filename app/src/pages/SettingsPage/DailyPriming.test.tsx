import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { getSettings } from '../../mocks/mockData';
import DailyPriming from './DailyPriming';

const RESTART = 'Restart the pod an hour before priming';

describe('DailyPriming', () => {
  it('turns the daily restart off through the settings update', async () => {
    const updateSettings = vi.fn();
    const settings = { ...getSettings(), primePodDaily: { enabled: true, time: '14:30' }, rebootDaily: true };
    const { user } = renderWithProviders(<DailyPriming settings={ settings } updateSettings={ updateSettings } />);

    await user.click(screen.getByRole('switch', { name: RESTART }));

    expect(updateSettings).toHaveBeenCalledWith({ rebootDaily: false });
  });

  // The restart is scheduled with priming, so it can't run while priming is off.
  it('disables the daily restart while daily priming is off', () => {
    const settings = { ...getSettings(), primePodDaily: { enabled: false, time: '14:30' }, rebootDaily: true };
    renderWithProviders(<DailyPriming settings={ settings } updateSettings={ vi.fn() } />);

    expect(screen.getByRole('switch', { name: RESTART })).toBeDisabled();
  });
});
