import { beforeEach, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { useAppStore } from '@state/appStore';
import { palette } from '../../design/tokens';
import { getSchedules } from '../../mocks/mockData';
import ScheduleTimeline from './ScheduleTimeline';
import { useScheduleStore } from './scheduleStore';

beforeEach(() => {
  useAppStore.setState({ side: 'left', isUpdating: false });
  const store = useScheduleStore.getState();
  store.setOriginalSchedules(structuredClone(getSchedules()));
  store.selectDay(1);
  store.updateSelectedSchedule({ power: { enabled: true, on: '21:00', off: '07:30' } });
  store.selectAlarm(0);
  store.updateSelectedAlarm({ enabled: false, time: '07:00' });
});

it('mutes a turned-off alarm without fading the card or its switch', () => {
  renderWithProviders(<ScheduleTimeline format="level"/>);
  const card = screen.getByRole('switch', { name: 'Enable alarm 1' }).closest('[data-testid="schedule-event"]')!;
  expect(getComputedStyle(card).opacity).not.toBe('0.6');
  expect(screen.getByLabelText('Wake at')).toHaveStyle({ color: palette.text.secondary });
  expect(screen.getByRole('switch', { name: 'Enable alarm 1' })).toBeEnabled();
});

it('keeps an enabled alarm at full strength', () => {
  useScheduleStore.getState().updateSelectedAlarm({ enabled: true });
  renderWithProviders(<ScheduleTimeline format="level"/>);
  expect(screen.getByLabelText('Wake at')).not.toHaveStyle({ color: palette.text.secondary });
});
