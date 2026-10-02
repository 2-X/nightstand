import { afterEach, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { useEventStreamStore } from '@api/eventStream';
import { palette } from '@design/tokens';
import { theme } from '../theme';
import PageHeader from './PageHeader';

afterEach(() => useEventStreamStore.setState({ state: 'idle' }));

it('gives reconnecting priority in the single page status slot', () => {
  render(<PageHeader title="Bed" status="Priming"/>);
  expect(screen.getByRole('heading', { level: 1, name: 'Bed' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Priming');
  act(() => useEventStreamStore.setState({ state: 'reconnecting' }));
  expect(screen.getByRole('status')).toHaveTextContent('Reconnecting');
  expect(screen.queryByText('Priming')).not.toBeInTheDocument();
});

it('shows a warning in the warning colour, ahead of a reconnecting socket', () => {
  useEventStreamStore.setState({ state: 'reconnecting' });
  render(<ThemeProvider theme={ theme }><PageHeader title="Bed" status="Not responding" tone="warn"/></ThemeProvider>);
  expect(screen.getByRole('status')).toHaveTextContent('Not responding');
  expect(screen.getByRole('status')).toHaveStyle({ color: palette.status.warn });
});

it('keeps Reconnecting ahead of a plain status', () => {
  useEventStreamStore.setState({ state: 'reconnecting' });
  render(<ThemeProvider theme={ theme }><PageHeader title="Bed" status="Priming"/></ThemeProvider>);
  expect(screen.getByRole('status')).toHaveTextContent('Reconnecting');
});

it('shows a plain status in the secondary text colour', () => {
  render(<ThemeProvider theme={ theme }><PageHeader title="Bed" status="Priming"/></ThemeProvider>);
  expect(screen.getByRole('status')).toHaveStyle({ color: palette.text.secondary });
});

it('keeps one status region in the header, empty until there is something to say', () => {
  const { rerender } = render(<PageHeader title="Bed"/>);
  const region = screen.getByRole('status');
  expect(region).toBeEmptyDOMElement();
  rerender(<PageHeader title="Bed" status="Not responding" tone="warn"/>);
  expect(screen.getByRole('status')).toBe(region);
  expect(region).toHaveTextContent('Not responding');
});
