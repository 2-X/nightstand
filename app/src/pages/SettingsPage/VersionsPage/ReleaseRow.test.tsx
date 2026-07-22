import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import ReleaseRow from './ReleaseRow';

const release = { kind: 'agent', version: '3.4.0', channel: 'stable', date: '2026-07-01' } as const;

describe('ReleaseRow', () => {
  it('posts an install request with the target version on confirm', async () => {
    let posted: any;
    server.use(
      http.post('*/update', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({});
      }),
    );

    const { user } = renderWithProviders(
      <ReleaseRow release={ release } runningVersion="3.3.0" body={ undefined }/>,
    );

    await user.click(screen.getByRole('button', { name: 'Install' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Install now' }));

    await waitFor(() => expect(posted).toEqual({ targetVersion: '3.4.0', allowDowngrade: false }));
  });

  it('closes the dialog on Cancel and fires no install', async () => {
    let installed = false;
    server.use(
      http.post('*/update', () => {
        installed = true;
        return HttpResponse.json({});
      }),
    );

    const { user } = renderWithProviders(
      <ReleaseRow release={ release } runningVersion="3.3.0" body={ undefined }/>,
    );

    await user.click(screen.getByRole('button', { name: 'Install' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(installed).toBe(false);
  });
});
