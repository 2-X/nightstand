import { describe, expect, it } from 'vitest';
import { delay, http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { renderApp, renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import MissedAlarmBanner from './MissedAlarmBanner';

const missed = (reason: string, side = 'left', at = '2026-10-05T13:30:00.000Z') => (
  { id: `${side}-${at}-${reason}`, side, at, reason, recordedAt: '2026-10-05T13:40:00.000Z' }
);
const serveMissed = (...items: unknown[]) => server.use(http.get('*/alarms/missed', () => HttpResponse.json({ missed: items })));

// The demo settings are in Los Angeles, so 13:30 UTC in October reads 6:30 AM.
const LINES: Array<[string, string]> = [
  ['not-running', 'The 6:30 AM alarm on the left side did not ring because Nightstand was not running.'],
  ['late', 'The 6:30 AM alarm on the left side did not ring because the Pod did not answer in time.'],
  ['failed', 'The 6:30 AM alarm on the left side did not ring because it could not be sent to the Pod.'],
  ['side-off', 'The 6:30 AM alarm on the left side did not ring because that side was off.'],
  ['error', 'The 6:30 AM alarm on the left side did not ring because of an error in Nightstand.'],
  ['unconfirmed', 'The 6:30 AM alarm on the left side may not have rung: the Pod did not confirm it.'],
];

// Both answers have arrived, so an empty banner is a decision and not a wait.
const answered = (queryClient: QueryClient) => waitFor(() => {
  expect(queryClient.getQueryState(['missedAlarms'])?.status).toBe('success');
  expect(queryClient.getQueryState(['useSettings'])?.status).toBe('success');
  expect(screen.getByRole('status')).toBeInTheDocument();
});

describe('MissedAlarmBanner', () => {
  it('shows nothing when no alarm was missed', async () => {
    serveMissed();
    const { container, queryClient } = renderWithProviders(<MissedAlarmBanner/>);
    await answered(queryClient);
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each(LINES)('says what happened to a %s alarm', async (reason, line) => {
    serveMissed(missed(reason));
    renderWithProviders(<MissedAlarmBanner/>);
    expect(await screen.findByText(line)).toBeVisible();
  });

  it('names the right side and reads the time in the Pod time zone', async () => {
    serveMissed(missed('late', 'right', '2026-10-05T04:05:00.000Z'));
    renderWithProviders(<MissedAlarmBanner/>);
    expect(await screen.findByText('The 9:05 PM alarm on the right side did not ring because the Pod did not answer in time.')).toBeVisible();
  });

  it('lists every missed alarm and skips a reason it does not know', async () => {
    serveMissed(missed('late'), { ...missed('from-the-future', 'right'), id: 'future' }, missed('side-off', 'right'));
    const { container } = renderWithProviders(<MissedAlarmBanner/>);
    await screen.findByText(/on the left side did not ring/);
    expect(screen.getByText(/on the right side did not ring because that side was off/)).toBeVisible();
    expect(container.textContent).not.toContain('future');
    expect(container.textContent?.match(/alarm on the/g)).toHaveLength(2);
  });

  it.each([
    ['a side it does not know', { side: 'up' }],
    ['a time it cannot read', { at: 'soon' }],
  ])('shows nothing for %s', async (_what, change) => {
    serveMissed({ ...missed('late'), ...change });
    const { container, queryClient } = renderWithProviders(<MissedAlarmBanner/>);
    await answered(queryClient);
    expect(container.textContent).toBe('');
  });

  it('shows nothing when the answer is not a list', async () => {
    server.use(http.get('*/alarms/missed', () => HttpResponse.json({ missed: 'none' })));
    const { container, queryClient } = renderWithProviders(<MissedAlarmBanner/>);
    await answered(queryClient);
    expect(container.textContent).toBe('');
  });

  it('announces politely from a region that exists before the alarms arrive', async () => {
    server.use(http.get('*/alarms/missed', async () => {
      await delay(50);
      return HttpResponse.json({ missed: [missed('late')] });
    }));
    renderWithProviders(<MissedAlarmBanner/>);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('');
    await within(region).findByText(/did not ring/);
    expect(screen.getByRole('status')).toBe(region);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('has a real Dismiss button with a 44 px target', async () => {
    serveMissed(missed('late'));
    renderWithProviders(<MissedAlarmBanner/>);
    const button = await screen.findByRole('button', { name: 'Dismiss' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveStyle({ minHeight: '44px' });
  });

  it('dismisses the alarms it shows, hides them and moves focus off the removed button', async () => {
    let dismissed: unknown;
    let alarms = [missed('late'), { ...missed('mystery'), id: 'unseen' }, missed('failed', 'right')];
    server.use(
      http.get('*/alarms/missed', () => HttpResponse.json({ missed: alarms })),
      http.post('*/alarms/missed/dismiss', async ({ request }) => {
        dismissed = await request.json();
        alarms = alarms.filter(item => !(dismissed as { ids: string[] }).ids.includes(item.id));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user, container } = renderWithProviders(<MissedAlarmBanner/>);
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(dismissed).toEqual({ ids: ['left-2026-10-05T13:30:00.000Z-late', 'right-2026-10-05T13:30:00.000Z-failed'] }));
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(screen.getByRole('status')).toHaveFocus();
  });

  it('keeps the alarms and the focus on the button when dismissing fails, and says so once', async () => {
    serveMissed(missed('late'));
    server.use(http.post('*/alarms/missed/dismiss', () => new HttpResponse(null, { status: 500 })));
    const { user } = renderWithProviders(<MissedAlarmBanner/>);
    const button = await screen.findByRole('button', { name: 'Dismiss' });
    await user.click(button);
    const region = screen.getByRole('status');
    expect(await within(region).findByText('Could not dismiss. Try again.')).toBeVisible();
    expect(screen.getAllByText('Could not dismiss. Try again.')).toHaveLength(1);
    expect(screen.getByText(/did not ring/)).toBeVisible();
    expect(button).toHaveFocus();
    expect(region).not.toHaveFocus();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears the failure message when Dismiss is tried again', async () => {
    let fail = true;
    let alarms = [missed('late')];
    server.use(
      http.get('*/alarms/missed', () => HttpResponse.json({ missed: alarms })),
      http.post('*/alarms/missed/dismiss', () => {
        if (fail) return new HttpResponse(null, { status: 500 });
        alarms = [];
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user, container } = renderWithProviders(<MissedAlarmBanner/>);
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    await screen.findByText('Could not dismiss. Try again.');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it('keeps keyboard focus on Dismiss while the request is pending', async () => {
    serveMissed(missed('late'));
    let requests = 0;
    server.use(http.post('*/alarms/missed/dismiss', async () => {
      requests += 1;
      await delay(100);
      return new HttpResponse(null, { status: 500 });
    }));
    const { user } = renderWithProviders(<MissedAlarmBanner/>);
    const button = await screen.findByRole('button', { name: 'Dismiss' });
    button.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'));
    expect(button).not.toBeDisabled();
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    await screen.findByText('Could not dismiss. Try again.');
    expect(requests).toBe(1);
    expect(button).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('skips a null or non-object item in the list', async () => {
    serveMissed(null, 'late', missed('late'));
    renderWithProviders(<MissedAlarmBanner/>);
    expect(await screen.findByText(/on the left side did not ring/)).toBeVisible();
    expect(screen.getAllByText(/did not ring/)).toHaveLength(1);
  });

  it('sits first in the page column, before the page', async () => {
    serveMissed(missed('late'));
    renderApp('/this-page-does-not-exist');
    const main = await screen.findByRole('main');
    const line = await screen.findByText(/did not ring/);
    const page = await screen.findByText('Page not found');
    expect(main).toContainElement(line);
    expect(line.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
