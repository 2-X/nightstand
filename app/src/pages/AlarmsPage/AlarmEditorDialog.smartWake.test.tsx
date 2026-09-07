import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import AlarmEditorDialog, { makeDefaultAlarm } from './AlarmEditorDialog';
import type { RecurringAlarm } from '@api/schedulesSchema.ts';

// The editor is a controlled dialog. These tests drive the Smart wake toggle
// and window slider directly.
describe('AlarmEditorDialog smart wake', () => {
  it('defaults smart wake off for a new alarm and hides the window slider', async () => {
    renderWithProviders(
      <AlarmEditorDialog open initial={ null } onCancel={ () => {} } onSave={ () => {} } />,
    );
    const toggle = await screen.findByLabelText('Smart wake');
    expect(toggle).not.toBeChecked();
    expect(screen.queryByLabelText(/smart wake window/i)).toBeNull();
  });

  it('enabling smart wake reveals the window slider and saves the field', async () => {
    const onSave = vi.fn();
    const { user } = renderWithProviders(
      <AlarmEditorDialog open initial={ null } onCancel={ () => {} } onSave={ onSave } />,
    );
    const toggle = await screen.findByLabelText('Smart wake');
    await user.click(toggle);
    await waitFor(() => expect(screen.getByLabelText(/smart wake window/i)).toBeInTheDocument());
    // Default window is shown.
    expect(screen.getByText(/Wake window: 30 min before/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as RecurringAlarm;
    expect(saved.smartWake).toEqual({ enabled: true, windowMinutes: 30 });
  });

  it('shows the existing window when editing a smart-wake alarm and can disable it', async () => {
    const initial: RecurringAlarm = {
      ...makeDefaultAlarm(),
      id: 'edit-me',
      smartWake: { enabled: true, windowMinutes: 45 },
    };
    const onSave = vi.fn();
    const { user } = renderWithProviders(
      <AlarmEditorDialog open initial={ initial } onCancel={ () => {} } onSave={ onSave } />,
    );
    expect(await screen.findByText(/Wake window: 45 min before/i)).toBeInTheDocument();
    // Toggle off => smartWake dropped from the saved alarm.
    await user.click(screen.getByLabelText('Smart wake'));
    await user.click(screen.getByRole('button', { name: /save/i }));
    const saved = onSave.mock.calls[0][0] as RecurringAlarm;
    expect(saved.smartWake).toBeUndefined();
  });
});
