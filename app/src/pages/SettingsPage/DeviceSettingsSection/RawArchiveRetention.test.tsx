import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@test/renderWithProviders';
import { getSettings } from '../../../mocks/mockData';
import RawArchiveRetention from './RawArchiveRetention';

describe('RawArchiveRetention', () => {
  it('shows the saved retention and sends the new one in days', async () => {
    const updateSettings = vi.fn();
    renderWithProviders(
      <RawArchiveRetention settings={ { ...getSettings(), rawArchiveRetentionDays: 14 } } updateSettings={ updateSettings }/>,
    );

    expect(screen.getByRole('button', { name: '2 weeks' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: '1 month' }));
    expect(updateSettings).toHaveBeenCalledWith({ rawArchiveRetentionDays: 30 });
  });
});
