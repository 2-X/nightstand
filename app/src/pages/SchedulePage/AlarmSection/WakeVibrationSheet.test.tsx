import { beforeEach, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { useAppStore } from '@state/appStore';
import { getSchedules } from '../../../mocks/mockData';
import { useScheduleStore } from '../scheduleStore';
import WakeVibrationSheet from './WakeVibrationSheet';

const note = 'Builds up needs a Pod 5 hub and cover, so alarms on this Pod use Double pulse.';

beforeEach(() => {
  useAppStore.setState({ side: 'left', isUpdating: false });
  const store = useScheduleStore.getState();
  store.setOriginalSchedules(structuredClone(getSchedules()));
  store.selectDay(1);
  store.selectAlarm(0);
  store.updateSelectedAlarm({ vibrationPattern: 'rise' });
});

it('offers Builds up on a Pod 5', () => {
  renderWithProviders(<WakeVibrationSheet open onClose={ () => {} } risePattern/>);
  expect(screen.getByRole('combobox', { name: 'Pattern' })).toHaveTextContent('Builds up');
  expect(screen.queryByText(note)).not.toBeInTheDocument();
});

it('shows the pattern the Pod will use and keeps Builds up out of reach on other Pods', () => {
  renderWithProviders(<WakeVibrationSheet open onClose={ () => {} } risePattern={ false }/>);
  const pattern = screen.getByRole('combobox', { name: 'Pattern' });
  expect(pattern).toHaveTextContent('Double pulse');
  expect(screen.getByText(note)).toBeInTheDocument();
  fireEvent.mouseDown(pattern);
  const options = within(screen.getByRole('listbox'));
  expect(options.getByRole('option', { name: 'Builds up' })).toHaveAttribute('aria-disabled', 'true');
  const store = useScheduleStore.getState();
  expect(store.getEditedAlarms()[store.selectedAlarmIndex].vibrationPattern).toBe('rise');
});
