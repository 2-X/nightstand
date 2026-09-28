import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SideControl from './SideControl';

const fixture = vi.hoisted(() => ({ presence: {
  left: { present: true, lastUpdatedAt: '2026-09-28T05:00:00Z', stateChangedAt: '2026-09-28T05:00:00Z' },
  right: { present: false, lastUpdatedAt: '2026-09-28T05:00:00Z', stateChangedAt: '2026-09-28T05:00:00Z' },
} }));
vi.mock('@state/appStore.tsx', () => ({ useAppStore: () => ({ side: 'left', setSide: vi.fn() }) }));
vi.mock('@api/settings.ts', () => ({ useSettings: () => ({ data: { left: { name: 'Left' }, right: { name: 'Right' } } }) }));
vi.mock('@api/deviceStatus.ts', () => ({ useDeviceStatus: () => ({ data: {} }) }));
vi.mock('@api/presence.ts', () => ({ usePresence: () => ({ data: fixture.presence }) }));
beforeEach(() => { fixture.presence.left.lastUpdatedAt = '2026-09-28T05:00:00Z'; });
afterEach(() => vi.restoreAllMocks());

it('heartbeat updates preserve the duration available to keyboard users', () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-28T05:00:10Z'));
  const view = render(<SideControl/>);
  expect(screen.getByRole('button', { name: /^Left/ })).toHaveAccessibleDescription('In bed for 10s');
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-28T05:01:00Z'));
  fixture.presence.left.lastUpdatedAt = '2026-09-28T05:01:00Z';
  view.rerender(<SideControl/>);
  expect(screen.getByRole('button', { name: /^Left/ })).toHaveAccessibleDescription('In bed for 1m');
});

it('stale observations are described as unavailable, not current occupancy', () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-29T05:00:00Z'));
  render(<SideControl/>);
  expect(screen.getByRole('button', { name: /^Left/ })).toHaveAccessibleDescription('Presence stale');
});
