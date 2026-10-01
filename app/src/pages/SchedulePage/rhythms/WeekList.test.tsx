import { expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import type { SideRhythms } from '@api/rhythmsSchema';
import { createDemoRhythms } from '../../../mocks/rhythmsMock';
import WeekList from './WeekList';

const demo = createDemoRhythms(new Date('2026-09-28T19:00:00Z'));

function renderWeek(sideData: SideRhythms, disabled = false) {
  const onPick = vi.fn();
  const view = renderWithProviders(<WeekList sideData={ sideData } disabled={ disabled } onPick={ onPick }/>);
  return { ...view, onPick };
}

it('shows one line for each run of days that share a rhythm', () => {
  renderWeek(demo.left);
  expect(screen.getByRole('button', { name: 'Sun to Thu: Workday' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Fri and Sat: Weekend' })).toBeInTheDocument();
  expect(screen.getAllByRole('button')).toHaveLength(2);
});

it('opens a single day with no day toggles and saves it', async () => {
  const { user, onPick } = renderWeek(demo.right);
  await user.click(screen.getByRole('button', { name: 'Monday: No sleep scheduled' }));
  const picker = await screen.findByRole('dialog', { name: 'Monday' });
  expect(within(picker).getByText('For sleeps that start on a Monday')).toBeInTheDocument();
  expect(within(picker).queryByText('Days to change')).not.toBeInTheDocument();
  expect(within(picker).getByRole('button', { name: /^No sleep scheduled/ })).toHaveAttribute('aria-current', 'true');
  await user.click(within(picker).getByRole('button', { name: /^Off days/ }));
  expect(onPick).toHaveBeenCalledWith(['monday'], 'off-days');
  expect(screen.queryByRole('dialog', { name: 'Monday' })).not.toBeInTheDocument();
});

it('starts a grouped line with every day on and follows the chosen days', async () => {
  const { user } = renderWeek(demo.left);
  await user.click(screen.getByRole('button', { name: 'Sun to Thu: Workday' }));
  const picker = await screen.findByRole('dialog', { name: 'Sun to Thu' });
  const days = within(picker).getAllByRole('button', { pressed: true });
  expect(days.map(day => day.getAttribute('aria-label'))).toEqual(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday']
    .map(day => day.charAt(0).toUpperCase() + day.slice(1)));
  expect(within(picker).getByRole('list', { name: 'Use for Sun to Thu' })).toBeInTheDocument();
  expect(within(picker).getByRole('button', { name: /^Workday/ })).toHaveAttribute('aria-current', 'true');
  await user.click(within(picker).getByRole('button', { name: 'Sunday' }));
  await user.click(within(picker).getByRole('button', { name: 'Monday' }));
  expect(screen.getByRole('dialog', { name: 'Tue to Thu' })).toBeInTheDocument();
  expect(within(picker).getByRole('list', { name: 'Use for Tue to Thu' })).toBeInTheDocument();
});

it('saves only the chosen days of a grouped line', async () => {
  const { user, onPick } = renderWeek(demo.left);
  await user.click(screen.getByRole('button', { name: 'Sun to Thu: Workday' }));
  const picker = await screen.findByRole('dialog', { name: 'Sun to Thu' });
  await user.click(within(picker).getByRole('button', { name: 'Sunday' }));
  await user.click(within(picker).getByRole('button', { name: 'Monday' }));
  await user.click(within(picker).getByRole('button', { name: /^No sleep scheduled/ }));
  expect(onPick).toHaveBeenCalledWith(['tuesday', 'wednesday', 'thursday'], null);
});

it('asks for a day before a grouped pick can be made', async () => {
  const { user, onPick } = renderWeek(demo.left);
  await user.click(screen.getByRole('button', { name: 'Fri and Sat: Weekend' }));
  const picker = await screen.findByRole('dialog', { name: 'Fri and Sat' });
  await user.click(within(picker).getByRole('button', { name: 'Friday' }));
  await user.click(within(picker).getByRole('button', { name: 'Saturday' }));
  expect(within(picker).getByText('Choose at least one day.')).toBeInTheDocument();
  expect(within(picker).getByRole('button', { name: /^Workday/ })).toHaveAttribute('aria-disabled', 'true');
  expect(onPick).not.toHaveBeenCalled();
});

it('ignores clicks but stays focusable while a save runs', async () => {
  const { user } = renderWeek(demo.left, true);
  const line = screen.getByRole('button', { name: 'Sun to Thu: Workday' });
  expect(line).toHaveAttribute('aria-disabled', 'true');
  expect(line).not.toBeDisabled();
  await user.click(line);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
