import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { usePresence } from '@api/presence.ts';

function PresenceProbe() {
  const { data } = usePresence();
  return <div>{ data ? 'presence-ready' : 'presence-loading' }</div>;
}

describe('presence MSW handler', () => {
  it('resolves GET /api/metrics/presence against MSW', async () => {
    renderWithProviders(<PresenceProbe />);
    expect(await screen.findByText('presence-ready')).toBeInTheDocument();
  });
});
