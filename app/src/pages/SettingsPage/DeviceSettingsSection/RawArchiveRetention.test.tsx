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

    expect(screen.getByRole('combobox', { name: 'Keep raw sensor recordings' })).toHaveTextContent('2 weeks');
    await userEvent.click(screen.getByRole('combobox', { name: 'Keep raw sensor recordings' }));
    await userEvent.click(screen.getByRole('option', { name: '1 month' }));
    expect(updateSettings).toHaveBeenCalledWith({ rawArchiveRetentionDays: 30 });
  });
});

it('disables retention when the server omits the setting', () => {
  const settings = { ...getSettings(), rawArchiveRetentionDays: undefined } as unknown as ReturnType<typeof getSettings>;
  renderWithProviders(<RawArchiveRetention settings={ settings } updateSettings={ vi.fn() }/>);
  expect(screen.getByRole('combobox', { name: 'Keep raw sensor recordings' })).toHaveAttribute('aria-disabled', 'true');
});
