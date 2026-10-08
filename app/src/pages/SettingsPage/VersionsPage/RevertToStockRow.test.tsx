import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import RevertToStockRow from './RevertToStockRow';
import targetFixtures from '../../../../../scripts/tests/fixtures/upstream_targets.json';
import { ReleasesManifestSchema } from '@api/releases';
import { SIDE_ON, serveInUse } from '@test/inUse';

const target = targetFixtures[1].expected!;
const manifest = ReleasesManifestSchema.parse(targetFixtures[1].manifest);

beforeEach(() => {
  server.use(http.get('https://raw.githubusercontent.com/LTimothy/nightstand/main/releases.json',
    () => HttpResponse.json(manifest)));
});

async function openDialog() {
  const view = renderWithProviders(<RevertToStockRow runningVersion="3.0.0"/>);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Switch to upstream free-sleep' })).toBeEnabled());
  await view.user.click(screen.getByRole('button', { name: 'Switch to upstream free-sleep' }));
  return view;
}

describe('RevertToStockRow', () => {
  it('closes the confirm dialog on Cancel and fires no request', async () => {
    let reverted = false;
    server.use(
      http.post('*/update/switch-to-upstream', () => {
        reverted = true;
        return HttpResponse.json({});
      }),
    );

    const { user } = await openDialog();
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
    return openDialog();
  };

  it('asks again after a refusal and sends a confirmed request only on Continue anyway', async () => {
    const bodies = serveInUse('*/update/switch-to-upstream', ['left-on']);
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: 'Switch to upstream free-sleep' }));
    expect(await screen.findByText(SIDE_ON)).toBeInTheDocument();
    expect(bodies).toEqual([{ target }]);
    await user.click(screen.getByRole('button', { name: 'Continue anyway' }));
    await waitFor(() => expect(bodies).toEqual([{ target }, { target, confirmInUse: true }]));
  });

  it('sends no confirmation when the bed is idle', async () => {
    const bodies = serveInUse('*/update/switch-to-upstream', []);
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: 'Switch to upstream free-sleep' }));
    await waitFor(() => expect(bodies).toEqual([{ target }]));
    expect(screen.queryByRole('button', { name: 'Continue anyway' })).not.toBeInTheDocument();
  });
});

describe('RevertToStockRow target confirmation', () => {
  it('disables the new switch without V2 and explains the legacy pin', async () => {
    server.use(http.get('https://raw.githubusercontent.com/LTimothy/nightstand/main/releases.json',
      () => HttpResponse.json({ channels: ['stable'], releases: [], upstreamSwitch: manifest.upstreamSwitch })));
    const { user } = await openDialog();
    expect(screen.getByText(/pinned pre-3.0 commit ca7dc543/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch to upstream free-sleep' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
  });

  it.each(['unavailable', 'malformed'])('sends no switch request when the manifest is %s', async state => {
    const bodies = serveInUse('*/update/switch-to-upstream', []);
    server.use(http.get('https://raw.githubusercontent.com/LTimothy/nightstand/main/releases.json', () =>
      state === 'unavailable' ? new HttpResponse(null, { status: 503 })
        : HttpResponse.json({ ...manifest, upstreamSwitchV2: { ...target, commit: 'main' } })));
    await openDialog();
    const confirm = screen.getByRole('button', { name: 'Switch to upstream free-sleep' });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(bodies).toEqual([]);
    expect(screen.getByText(/No validated target/)).toBeInTheDocument();
  });

  it('shows the exact target, and refuses a manifest change while confirmation is open', async () => {
    const { queryClient } = await openDialog();
    expect(screen.getByText(new RegExp(target.commit))).toBeInTheDocument();
    queryClient.setQueryData(['useReleases'], {
      ...manifest, upstreamSwitchV2: { ...target, commit: 'b'.repeat(40) },
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Switch to upstream free-sleep' })).toBeDisabled());
    expect(screen.getByText(/target changed/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(target.commit))).toBeInTheDocument();
    expect(screen.queryByText(new RegExp('b'.repeat(40)))).not.toBeInTheDocument();
  });

  it('does not substitute a new target after a bed-use refusal', async () => {
    const bodies = serveInUse('*/update/switch-to-upstream', ['left-on']);
    const { user, queryClient } = await openDialog();
    await user.click(screen.getByRole('button', { name: 'Switch to upstream free-sleep' }));
    expect(await screen.findByText(SIDE_ON)).toBeInTheDocument();
    queryClient.setQueryData(['useReleases'], { ...manifest, upstreamSwitchV2: undefined });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue anyway' })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Continue anyway' }));
    expect(bodies).toEqual([{ target }]);
  });
});
