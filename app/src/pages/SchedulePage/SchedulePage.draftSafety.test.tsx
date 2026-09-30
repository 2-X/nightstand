import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@test/renderWithProviders';
import { useAppStore } from '@state/appStore';
import { useScheduleStore } from './scheduleStore';
import SchedulePage from './SchedulePage';

beforeEach(() => {
  useAppStore.setState({ side: 'left', isUpdating: false });
  useScheduleStore.setState(useScheduleStore.getInitialState(), true);
});

it('keeps copied days visible when the edited night is disabled', async () => {
  renderWithProviders(<SchedulePage/>);
  await screen.findByLabelText('Turn on at');
  act(() => {
    useScheduleStore.getState().selectDay(1);
    useScheduleStore.getState().toggleSelectedDay('wednesday');
  });
  fireEvent.click(screen.getByRole('switch', { name: /^Schedule \w+ night$/ }));
  expect(screen.getByText('Apply settings to other days')).toBeInTheDocument();
  const draft = screen.getByRole('status');
  expect(draft).toHaveTextContent('Unsaved: Monday and 1 more, Alex');
  expect(draft).toHaveAttribute('title', 'Unsaved: Monday, Wednesday, Alex');
  fireEvent.click(screen.getByText('Apply settings to other days'));
  fireEvent.click(screen.getByRole('button', { name: 'Wednesday' }));
  expect(useScheduleStore.getState().selectedDays.wednesday).toBe(false);
});

it('keeps keyboard focus above the draft bar and restores page scroll padding on exit', async () => {
  const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
  const { unmount } = renderWithProviders(<SchedulePage/>);
  const input = await screen.findByLabelText('Turn on at');
  const previousPadding = document.documentElement.style.scrollPaddingBottom;
  act(() => useScheduleStore.getState().updateSelectedSchedule({ power: { onTemperature: 84 } }));
  expect(document.documentElement.style.scrollPaddingBottom).toBe('160px');
  vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({ top: 700, bottom: 744 } as DOMRect);
  fireEvent.focus(input);
  expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
  expect(getComputedStyle(input).scrollMarginBottom).toBe('160px');
  unmount();
  expect(document.documentElement.style.scrollPaddingBottom).toBe(previousPadding);
});

it('offers a fix action and explanation for schema validation failures', async () => {
  renderWithProviders(<SchedulePage/>);
  await screen.findByLabelText('Turn on at');
  act(() => useScheduleStore.getState().updateSelectedSchedule({ power: { onTemperature: 111 } }));
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Fix schedule' }));
  expect(screen.getByRole('alert')).toHaveTextContent(/bedtime temperature/i);
  expect(screen.getByRole('spinbutton', { name: 'Bedtime temperature' })).toHaveFocus();
});

it('keeps the already-focused control visible when another draft edit moves rows', async () => {
  const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
  renderWithProviders(<SchedulePage/>);
  const input = await screen.findByLabelText('Turn on at');
  act(() => useScheduleStore.getState().updateSelectedSchedule({ power: { onTemperature: 84 } }));
  let top = 200;
  vi.spyOn(input, 'getBoundingClientRect').mockImplementation(() => ({ top, bottom: top + 44 } as DOMRect));
  act(() => input.focus());
  scroll.mockClear();
  top = 700;
  act(() => useScheduleStore.getState().addAlarm());
  expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
});
