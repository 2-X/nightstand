import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import RevertToStockRow from './RevertToStockRow';

describe('RevertToStockRow', () => {
  it('closes the confirm dialog on Cancel and fires no request', async () => {
    let reverted = false;
    server.use(
      http.post('*/update/revert-to-stock', () => {
        reverted = true;
        return HttpResponse.json({});
      }),
    );

    const { user } = renderWithProviders(<RevertToStockRow runningVersion="3.0.0" />);

    await user.click(screen.getByText('Revert to stock upstream free-sleep'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(reverted).toBe(false);
  });
});
