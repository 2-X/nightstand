import { afterEach, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useEventStreamStore } from '@api/eventStream';
import PageHeader from './PageHeader';

afterEach(() => useEventStreamStore.setState({ state: 'open' }));

it('gives reconnecting priority in the single page status slot', () => {
  render(<PageHeader title="Bed" status="Priming"/>);
  expect(screen.getByRole('heading', { level: 1, name: 'Bed' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Priming');
  act(() => useEventStreamStore.setState({ state: 'reconnecting' }));
  expect(screen.getByRole('status')).toHaveTextContent('Reconnecting');
  expect(screen.queryByText('Priming')).not.toBeInTheDocument();
});
