import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import RevertToStockRow from './RevertToStockRow';
import { SIDE_ON, serveInUse } from '@test/inUse';

describe('RevertToStockRow', () => {
  it('closes the confirm dialog on Cancel and fires no request', async () => {
    let reverted = false;
    server.use(
      http.post('*/update/switch-to-upstream', () => {
        reverted = true;
        return HttpResponse.json({});
      }),
    );

    const { user } = renderWithProviders(<RevertToStockRow runningVersion="3.0.0" />);

    await user.click(screen.getByText('Switch to upstream free-sleep'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(reverted).toBe(false);
  });
});

it('exposes recovery as a keyboard-accessible button', () => {
  renderWithProviders(<RevertToStockRow runningVersion="3.0.0"/>);
  expect(screen.getByRole('button', { name: 'Switch to upstream free-sleep' })).toBeInTheDocument();
});

describe('RevertToStockRow when the bed may be in use', () => {
  const open = async () => {
    const view = renderWithProviders(<RevertToStockRow runningVersion="3.0.0"/>);
    await view.user.click(screen.getByText('Switch to upstream free-sleep'));
    return view;
  };

  it('asks again after a refusal and sends a confirmed request only on Continue anyway', async () => {
    const bodies = serveInUse('*/update/switch-to-upstream', ['left-on']);
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: 'Switch to upstream free-sleep' }));
    expect(await screen.findByText(SIDE_ON)).toBeInTheDocument();
    expect(bodies).toEqual([undefined]);
    await user.click(screen.getByRole('button', { name: 'Continue anyway' }));
    await waitFor(() => expect(bodies).toEqual([undefined, { confirmInUse: true }]));
  });

  it('sends no confirmation when the bed is idle', async () => {
    const bodies = serveInUse('*/update/switch-to-upstream', []);
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: 'Switch to upstream free-sleep' }));
    await waitFor(() => expect(bodies).toEqual([undefined]));
    expect(screen.queryByRole('button', { name: 'Continue anyway' })).not.toBeInTheDocument();
  });
});

describe('RevertToStockRow says what the switch installs', () => {
  const UNCHECKED_UPSTREAM_NOTE = 'Installs upstream free-sleep\'s newest code, which this switch has not been checked with.';

  it('says upstream\'s newest code is unchecked while no checked commit is recorded', async () => {
    server.use(http.get('https://raw.githubusercontent.com/LTimothy/nightstand/main/releases.json', () => HttpResponse.json({
      channels: ['stable', 'beta'],
      releases: [],
    })));
    const { user } = renderWithProviders(<RevertToStockRow runningVersion="3.0.0"/>);
    await user.click(screen.getByText('Switch to upstream free-sleep'));
    expect(await screen.findByText(UNCHECKED_UPSTREAM_NOTE)).toBeInTheDocument();
  });

  it('names the date of the checked upstream commit once one is recorded', async () => {
    server.use(http.get('https://raw.githubusercontent.com/LTimothy/nightstand/main/releases.json', () => HttpResponse.json({
      channels: ['stable', 'beta'],
      releases: [],
      upstreamSwitch: { commit: 'a'.repeat(40), date: '2026-10-09', treeSha256: 'b'.repeat(64) },
    })));
    const { user } = renderWithProviders(<RevertToStockRow runningVersion="3.0.0"/>);
    await user.click(screen.getByText('Switch to upstream free-sleep'));
    expect(await screen.findByText(
      'Installs upstream free-sleep as of 2026-10-09, the version this switch was last checked with.',
    )).toBeInTheDocument();
    expect(screen.queryByText(UNCHECKED_UPSTREAM_NOTE)).not.toBeInTheDocument();
  });
});
