import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBedFrame } from './useBedFrame';

const T = Date.parse('2026-09-29T04:41:00Z');
const status = { isOn: true, targetTemperatureF: 84, currentTemperatureF: 82 };
const fixture = vi.hoisted(() => ({ query: {} as Record<string, unknown> }));
vi.mock('@api/deviceStatus', () => ({ useDeviceStatus: () => fixture.query }));
vi.mock('@state/appStore', () => ({ useAppStore: () => ({ side: 'left' }) }));

function Probe() {
  const { frame } = useBedFrame();
  return <p>{ frame.kind }{ frame.kind === 'stale' ? ` since ${frame.since.toISOString()}` : '' }</p>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T);
});
afterEach(() => vi.useRealTimers());

it('turns stale on its own two minutes after the last status', () => {
  fixture.query = { data: { left: status }, dataUpdatedAt: T, isError: false, isFetching: false, failureCount: 0 };
  render(<Probe/>);
  expect(screen.getByText('live')).toBeInTheDocument();
  act(() => { vi.advanceTimersByTime(119_000); });
  expect(screen.getByText('live')).toBeInTheDocument();
  act(() => { vi.advanceTimersByTime(2_000); });
  expect(screen.getByText(`stale since ${new Date(T).toISOString()}`)).toBeInTheDocument();
});

it('dates a first load that failed from its first render', () => {
  fixture.query = { data: undefined, dataUpdatedAt: 0, isError: true, isFetching: false, failureCount: 3 };
  render(<Probe/>);
  expect(screen.getByText(`stale since ${new Date(T).toISOString()}`)).toBeInTheDocument();
});

it('is loading before the first answer', () => {
  fixture.query = { data: undefined, dataUpdatedAt: 0, isError: false, isFetching: true, failureCount: 0 };
  render(<Probe/>);
  expect(screen.getByText('loading')).toBeInTheDocument();
});

it('goes stale, live while a refresh is under way, stale when it fails, then live and stale again on new data', () => {
  const settled = { isError: false, isFetching: false, failureCount: 0, errorUpdateCount: 0 };
  fixture.query = { ...settled, data: { left: status }, dataUpdatedAt: T };
  const { rerender } = render(<Probe/>);
  act(() => { vi.advanceTimersByTime(121_000); });
  expect(screen.getByText(`stale since ${new Date(T).toISOString()}`)).toBeInTheDocument();

  fixture.query = { ...fixture.query, isFetching: true };
  rerender(<Probe/>);
  expect(screen.getByText('live')).toBeInTheDocument();

  fixture.query = { ...fixture.query, isFetching: false, isError: true, failureCount: 1, errorUpdateCount: 1 };
  rerender(<Probe/>);
  expect(screen.getByText(`stale since ${new Date(T).toISOString()}`)).toBeInTheDocument();

  const fresh = Date.now();
  fixture.query = { ...settled, data: { left: { ...status } }, dataUpdatedAt: fresh, errorUpdateCount: 1 };
  rerender(<Probe/>);
  expect(screen.getByText('live')).toBeInTheDocument();
  act(() => { vi.advanceTimersByTime(119_000); });
  expect(screen.getByText('live')).toBeInTheDocument();
  act(() => { vi.advanceTimersByTime(2_000); });
  expect(screen.getByText(`stale since ${new Date(fresh).toISOString()}`)).toBeInTheDocument();
});

it('keeps a failed first load stale while it is asked again', () => {
  fixture.query = { data: undefined, dataUpdatedAt: 0, isError: false, isFetching: true, failureCount: 0, errorUpdateCount: 1 };
  render(<Probe/>);
  expect(screen.getByText(`stale since ${new Date(T).toISOString()}`)).toBeInTheDocument();
});
