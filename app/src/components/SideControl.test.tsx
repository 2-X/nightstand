import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SideControl from './SideControl';

const fixture = vi.hoisted(() => ({
  setSide: vi.fn(), enabled: true,
  settings: { left: { name: 'Alex', awayMode: false }, right: { name: 'Sam', awayMode: false } },
  presence: { left: { present: true, lastUpdatedAt: '2026-09-28T05:00:00Z', stateChangedAt: '2026-09-28T04:48:00Z' } },
}));
vi.mock('@state/appStore.tsx', () => ({ useAppStore: () => ({ side: 'left', setSide: fixture.setSide }) }));
vi.mock('@api/settings.ts', () => ({ useSettings: () => ({ data: fixture.settings }) }));
vi.mock('@api/deviceStatus.ts', () => ({
  useDeviceStatus: () => ({ data: { left: { isOn: false }, right: { isOn: false } } }),
}));
vi.mock('@api/presence.ts', () => ({ usePresence: () => ({ data: fixture.presence }) }));
vi.mock('@api/services.ts', () => ({
  useServices: () => ({ data: { biometrics: { enabled: fixture.enabled, jobs: { calibrateLeft: { status: 'healthy' } } } } }),
}));
beforeEach(() => {
  fixture.enabled = true;
  fixture.settings.right.awayMode = false;
  fixture.setSide.mockClear();
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-28T05:00:00Z'));
});
afterEach(() => vi.restoreAllMocks());

it('shows both named side states and exposes selection as radios', () => {
  render(<SideControl compact={ false }/>);
  expect(screen.getByRole('radiogroup', { name: 'Bed side' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Alex. Off. In bed 12 min.' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Sam. Off.' })).not.toBeChecked();
});
it('leaves uncertain and disabled presence out of the tiles', () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-29T05:00:00Z'));
  const view = render(<SideControl compact={ false }/>);
  expect(screen.queryByText(/In bed/)).not.toBeInTheDocument();
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-28T05:00:00Z'));
  fixture.enabled = false;
  view.rerender(<SideControl compact={ false }/>);
  expect(screen.queryByText(/In bed/)).not.toBeInTheDocument();
});
it('merges the active controls when the other side is away', () => {
  fixture.settings.right.awayMode = true;
  render(<SideControl/>);
  expect(screen.getAllByRole('radio')).toHaveLength(1);
  expect(screen.getByRole('radio', { name: /Both sides. Alex's controls apply to both sides/ })).toBeChecked();
});
it('honors the unsaved edit guard before switching sides', () => {
  const guard = vi.fn(() => false);
  const view = render(<SideControl beforeSideChange={ guard }/>);
  fireEvent.click(screen.getByRole('radio', { name: 'Sam. Off.' }));
  expect(guard).toHaveBeenCalledOnce();
  expect(fixture.setSide).not.toHaveBeenCalled();
  view.rerender(<SideControl/>);
  fireEvent.click(screen.getByRole('radio', { name: 'Sam. Off.' }));
  expect(fixture.setSide).toHaveBeenCalledWith('right');
});

it('keeps an away side available when browsing its history', () => {
  fixture.settings.right.awayMode = true;
  render(<SideControl mergeAwaySides={ false }/>);
  expect(screen.getAllByRole('radio')).toHaveLength(2);
  fireEvent.click(screen.getByRole('radio', { name: 'Sam. Away.' }));
  expect(fixture.setSide).toHaveBeenCalledWith('right');
});

it('uses the selected night captions instead of live bed states when supplied', () => {
  render(<SideControl mergeAwaySides={ false } captions={ { left: '86, 6h 30m', right: 'No recording' } }/>);
  expect(screen.getByRole('radio', { name: 'Alex. 86, 6h 30m.' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Sam. No recording.' })).toBeInTheDocument();
  expect(screen.queryByText('Off')).not.toBeInTheDocument();
});
