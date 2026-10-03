import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@test/renderWithProviders';
import DemoBanner from './DemoBanner';

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('DemoBanner', () => {
  it('says it is a demo and links to the repository', () => {
    renderWithProviders(<DemoBanner/>);
    expect(screen.getByText('Demo with sample data. Nothing here controls a real Pod.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View on GitHub' })).toHaveAttribute('href', 'https://github.com/LTimothy/nightstand');
  });

  it('stays dismissed for the rest of the session', async () => {
    const view = renderWithProviders(<DemoBanner/>);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('link', { name: 'View on GitHub' })).not.toBeInTheDocument();
    view.unmount();
    renderWithProviders(<DemoBanner/>);
    expect(screen.queryByRole('link', { name: 'View on GitHub' })).not.toBeInTheDocument();
  });

  it('still shows and dismisses when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    renderWithProviders(<DemoBanner/>);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('link', { name: 'View on GitHub' })).not.toBeInTheDocument();
  });
});
