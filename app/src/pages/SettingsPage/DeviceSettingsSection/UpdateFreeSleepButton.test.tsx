import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import UpdateFreeSleepButton from './UpdateFreeSleepButton';

describe('UpdateFreeSleepButton', () => {
  it('posts the update job on confirm', async () => {
    let posted: any;
    server.use(
      http.post('*/jobs', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({}, { status: 204 });
      }),
    );

    const { user } = renderWithProviders(<UpdateFreeSleepButton runningVersion="3.0.0"/>);

    await user.click(screen.getByRole('button', { name: 'Update' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Update now' }));

    await waitFor(() => expect(posted).toEqual(['update']));
  });

  it('closes the dialog on Cancel and fires no job', async () => {
    let jobbed = false;
    server.use(
      http.post('*/jobs', () => {
        jobbed = true;
        return HttpResponse.json({}, { status: 204 });
      }),
    );

    const { user } = renderWithProviders(<UpdateFreeSleepButton runningVersion="3.0.0"/>);

    await user.click(screen.getByRole('button', { name: 'Update' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(jobbed).toBe(false);
  });
});
