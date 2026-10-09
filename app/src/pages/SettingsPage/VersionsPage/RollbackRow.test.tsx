import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import RollbackRow from './RollbackRow';
import { SIDE_ON, serveInUse } from '@test/inUse';

describe('RollbackRow', () => {
  it('closes the confirm dialog on Cancel and fires no request', async () => {
    let rolledBack = false;
    server.use(
      http.post('*/update/rollback', () => {
        rolledBack = true;
        return HttpResponse.json({});
      }),
    );

    const { user } = renderWithProviders(
      <RollbackRow runningVersion="3.0.0" rollbackVersion="2.9.0" />,
    );

    await user.click(screen.getByRole('button', { name: 'Go back to v2.9.0 Instant, no download' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(rolledBack).toBe(false);
  });
});

it('exposes recovery as a keyboard-accessible button', () => {
  renderWithProviders(<RollbackRow runningVersion="3.0.0" rollbackVersion="2.9.0"/>);
  expect(screen.getByRole('button', { name: 'Go back to v2.9.0 Instant, no download' })).toBeInTheDocument();
});

describe('RollbackRow when the bed may be in use', () => {
  const open = async () => {
    const view = renderWithProviders(<RollbackRow runningVersion="3.0.0" rollbackVersion="2.9.0"/>);
    await view.user.click(screen.getByRole('button', { name: 'Go back to v2.9.0 Instant, no download' }));
    return view;
  };

  it('asks again after a refusal and sends a confirmed request only on Continue anyway', async () => {
    const bodies = serveInUse('*/update/rollback', ['right-on']);
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: 'Go back now' }));
    expect(await screen.findByText(SIDE_ON)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(SIDE_ON);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    expect(bodies).toEqual([undefined]);
    await user.click(screen.getByRole('button', { name: 'Continue anyway' }));
    await waitFor(() => expect(bodies).toEqual([undefined, { confirmInUse: true }]));
  });

  it('sends no confirmation when the bed is idle', async () => {
    const bodies = serveInUse('*/update/rollback', []);
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: 'Go back now' }));
    await waitFor(() => expect(bodies).toEqual([undefined]));
    expect(screen.queryByRole('button', { name: 'Continue anyway' })).not.toBeInTheDocument();
  });

  it('cancels from the second confirmation without another request', async () => {
    const bodies = serveInUse('*/update/rollback', ['alarm-soon']);
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: 'Go back now' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(bodies).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Go back to v2.9.0 Instant, no download' }));
    expect(await screen.findByRole('button', { name: 'Go back now' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('puts focus back on the row after Escape', async () => {
    serveInUse('*/update/rollback', ['alarm-soon']);
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: 'Go back now' }));
    await screen.findByRole('button', { name: 'Continue anyway' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Go back to v2.9.0 Instant, no download' })).toHaveFocus());
  });
});
