import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { palette } from '@design/tokens';
import { getDeviceStatus } from '../../mocks/mockData';
import TemperatureDial from './TemperatureDial';
import { useControlTempStore } from './controlTempStore';

const post = vi.hoisted(() => vi.fn());
vi.mock('@api/deviceStatus.ts', () => ({ postDeviceStatus: post, useDeviceStatus: () => ({ data: undefined }) }));
vi.mock('@api/settings.ts', () => ({ useSettings: () => ({ data: { timeZone: 'UTC', left: { awayMode: false } } }) }));
vi.mock('@state/appStore', () => ({ useAppStore: () => ({ side: 'left', setIsUpdating: vi.fn() }) }));
vi.mock('./TemperatureButtons', () => ({ default: () => <button>Temperature stepper</button> }));
vi.mock('./useBedCaption', () => ({
  useBedCaption: (isOn: boolean) => [isOn ? 'Turns off tomorrow at 6:45 AM' : 'Turns on tonight at 10:00 PM'],
}));

beforeEach(() => useControlTempStore.setState({ deviceStatus: undefined }));

const on = { isOn: true, targetTemperatureF: 83, currentTemperatureF: 75 };

it('shows the target and current temperature without a draggable control', () => {
  render(<TemperatureDial status={ on } refetch={ vi.fn() } format="level"/>);
  expect(screen.getByRole('heading', { level: 2, name: '0' })).toBeInTheDocument();
  expect(screen.getByText('Currently at \u22123')).toBeInTheDocument();
  expect(screen.getByText('Warming to')).toBeInTheDocument();
  expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  fireEvent.pointerDown(screen.getByText('0'));
  fireEvent.pointerUp(screen.getByText('0'));
  expect(post).not.toHaveBeenCalled();
});

it('sets the sign of a level apart from its digits', () => {
  render(<TemperatureDial status={ { ...on, targetTemperatureF: 74 } } refetch={ vi.fn() } format="level"/>);
  const heading = screen.getByRole('heading', { level: 2 });
  expect(heading).toHaveTextContent('\u22123');
  expect(heading.querySelector('span')).toHaveTextContent('\u2212');
});

it('shows the steppers only while on, and what it is given in their place while off', () => {
  const { rerender } = render(<TemperatureDial status={ on } refetch={ vi.fn() } format="level" whenOff={ <span>Last night</span> }/>);
  expect(screen.getByText('Temperature stepper')).toBeInTheDocument();
  expect(screen.queryByText('Last night')).not.toBeInTheDocument();
  rerender(<TemperatureDial status={ { ...on, isOn: false } } refetch={ vi.fn() } format="level" whenOff={ <span>Last night</span> }/>);
  expect(screen.queryByText('Temperature stepper')).not.toBeInTheDocument();
  expect(screen.getByText('Off')).toBeInTheDocument();
  expect(screen.getByText('Last night')).toBeInTheDocument();
});

it('shows last night, not the steppers, for an away side that is on', () => {
  render(<TemperatureDial status={ on } away refetch={ vi.fn() } format="level" whenOff={ <span>Last night</span> }/>);
  expect(screen.queryByText('Temperature stepper')).not.toBeInTheDocument();
  expect(screen.getByText('Last night')).toBeInTheDocument();
});

it('draws an away side that is on in grey, ring and numeral', () => {
  const { container } = render(<TemperatureDial status={ on } away refetch={ vi.fn() } format="level"/>);
  expect(container.querySelector('[data-dial] path[data-band="off"]')).not.toBeNull();
  expect(container.querySelector('[data-dial] g[data-band="fill"]')).toBeNull();
  expect(screen.getByRole('heading', { level: 2, name: '0' })).toHaveStyle({ color: palette.text.secondary });
});

it('says Loading in the dial and leaves every slot empty while the status loads', () => {
  const { container } = render(<TemperatureDial loading refetch={ vi.fn() } format="level"/>);
  const dial = within(container.querySelector<HTMLElement>('[data-dial]')!);
  expect(dial.getByRole('status')).toHaveTextContent('Loading');
  expect(dial.getByRole('status')).toHaveStyle({ color: palette.text.tertiary });
  expect(container.querySelector('[data-dial] path[data-band="off"]')).not.toBeNull();
  expect(container.querySelector('[data-caption-slot]')!.textContent).toBe('');
  expect(container.querySelector('[data-controls-row]')).toBeEmptyDOMElement();
});

it('fills the Loading region only once it is in the page, so it is announced', () => {
  const markup = renderToStaticMarkup(<TemperatureDial loading refetch={ vi.fn() } format="level"/>);
  expect(markup).toMatch(/role="status"[^>]*><\/p>/);
  expect(markup).not.toContain('Loading');
});

it('draws the empty track and no text before the status loads', () => {
  const { container } = render(<TemperatureDial refetch={ vi.fn() } format="level"/>);
  expect(container.querySelector('[data-dial] path[data-band="off"]')).not.toBeNull();
  expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  expect(screen.queryByText('Off')).not.toBeInTheDocument();
});

it('puts the steppers, or what it is given while off, in one controls row under the dial', () => {
  const { container, rerender } = render(
    <TemperatureDial status={ on } refetch={ vi.fn() } format="level" whenOff={ <span>Last night</span> }/>);
  const row = () => container.querySelector('[data-controls-row]')!;
  expect(row()).toContainElement(screen.getByText('Temperature stepper'));
  expect(container.querySelector('[data-dial]')).not.toContainElement(screen.getByText('Temperature stepper'));
  rerender(<TemperatureDial status={ { ...on, isOn: false } } refetch={ vi.fn() } format="level" whenOff={ <span>Last night</span> }/>);
  expect(row()).toContainElement(screen.getByText('Last night'));
});

it('puts the caption in its own slot between the dial and the controls row', () => {
  const { container } = render(<TemperatureDial status={ on } refetch={ vi.fn() } format="level"/>);
  const slot = container.querySelector('[data-caption-slot]')!;
  expect(slot).toHaveTextContent('Turns off tomorrow at 6:45 AM');
  expect(slot.previousElementSibling).toHaveAttribute('data-dial');
  expect(slot.nextElementSibling).toHaveAttribute('data-controls-row');
});

it('sets a level in the large light numeral', () => {
  render(<TemperatureDial status={ on } refetch={ vi.fn() } format="level"/>);
  expect(screen.getByRole('heading', { level: 2 })).toHaveStyle({ fontSize: '100px', fontWeight: '300' });
  expect(screen.getByText('Warming to')).toHaveStyle({ fontSize: '15px' });
});

it('writes °F at the smaller numeral size', () => {
  render(<TemperatureDial status={ { ...on, targetTemperatureF: 84 } } refetch={ vi.fn() } format="fahrenheit"/>);
  const numeral = screen.getByRole('heading', { level: 2 });
  expect(numeral).toHaveTextContent('84°F');
  expect(numeral).toHaveStyle({ fontSize: '64px' });
});

it('says Off in the large light face while off', () => {
  render(<TemperatureDial status={ { ...on, isOn: false } } refetch={ vi.fn() } format="level"/>);
  expect(screen.getByText('Off')).toHaveStyle({ fontSize: '84px', fontWeight: '300' });
});

it('says "Set to" and draws a hollow dot while an edit waits for the Pod', () => {
  const status = getDeviceStatus();
  useControlTempStore.setState({ deviceStatus: { ...status, left: { ...status.left, ...on, targetTemperatureF: 86 } } });
  const { container } = render(<TemperatureDial status={ on } refetch={ vi.fn() } format="level"/>);
  expect(screen.getByText('Set to')).toBeInTheDocument();
  expect(container.querySelector('circle[data-pending]')).not.toBeNull();
});

const since = new Date('2026-09-29T04:41:00Z');

it('greys a last known status, dates it, and says what that means for tonight', () => {
  const { container } = render(<TemperatureDial status={ on } staleSince={ since } refetch={ vi.fn() } format="level"/>);
  expect(screen.getByText('Last known')).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: '0' })).toHaveStyle({ color: palette.text.secondary });
  expect(screen.getByText('at 4:41 AM')).toBeInTheDocument();
  const slot = container.querySelector('[data-caption-slot]')!;
  expect(slot).toHaveTextContent('No response from the Pod since 4:41 AM.Schedules and alarms may not run.');
  expect(slot.querySelector('[role="status"]')).not.toBeNull();
  expect(container.querySelector('circle[data-stale]')).not.toBeNull();
  expect(screen.getByText('Temperature stepper')).toBeInTheDocument();
});

it('keeps one empty status region in the caption slot and fills it when the Pod stops answering', () => {
  const { container, rerender } = render(<TemperatureDial status={ on } refetch={ vi.fn() } format="level"/>);
  const region = container.querySelector('[data-caption-slot] [role="status"]');
  expect(region).not.toBeNull();
  expect(region!.textContent).toBe('');
  rerender(<TemperatureDial status={ on } staleSince={ since } refetch={ vi.fn() } format="level"/>);
  expect(container.querySelector('[data-caption-slot] [role="status"]')).toBe(region);
  expect(region).toHaveTextContent('No response from the Pod since 4:41 AM.');
});

it('says Off with its time for a side last known to be off', () => {
  render(<TemperatureDial status={ { ...on, isOn: false } } staleSince={ since } refetch={ vi.fn() } format="level"/>);
  expect(screen.getByText('Last known')).toBeInTheDocument();
  expect(screen.getByText('Off')).toBeInTheDocument();
  expect(screen.getByText('at 4:41 AM')).toBeInTheDocument();
});

it('draws an empty frame with the stale caption when nothing ever loaded', () => {
  const { container } = render(<TemperatureDial staleSince={ since } refetch={ vi.fn() } format="level"/>);
  expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  expect(container.querySelector('[data-caption-slot]')).toHaveTextContent('Schedules and alarms may not run.');
  expect(container.querySelector('[data-controls-row]')).toBeEmptyDOMElement();
});
