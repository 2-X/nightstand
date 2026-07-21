import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import RollbackRow from './RollbackRow';

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

    await user.click(screen.getByText('Roll back to v2.9.0 (instant, no download)'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(rolledBack).toBe(false);
  });
});
