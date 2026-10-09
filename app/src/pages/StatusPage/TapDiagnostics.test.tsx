import { afterEach, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import type { FirmwareSnapshot } from '@api/firmware';
import TapDiagnostics from './TapDiagnostics';

afterEach(() => vi.unstubAllGlobals());

it('lists diagnostic source, side and timestamps and exports the server snapshot', async () => {
  const tap = { kind: 'tap' as const, origin: 'buttonEvent' as const, side: 'right' as const,
    control: 'top' as const, count: 1, source: 'RAW' as const, timestamp: 100, receivedAt: 101, sequence: 17, index: 12 };
  const data = { availability: 'Monitoring active', taps: [tap] } as FirmwareSnapshot;
  let exported = 0;
  let blob: Blob | undefined;
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL(value: Blob) { blob = value; return 'blob:diagnostics'; }
    static revokeObjectURL() {}
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  server.use(http.get('*/api/services/firmware/taps/export', () => {
    exported++;
    return HttpResponse.json({ availability: data.availability, taps: data.taps });
  }));
  const { user } = renderWithProviders(<TapDiagnostics data={ data } />);
  await user.click(screen.getByRole('button', { name: 'Tap diagnostics (1)' }));
  expect(screen.getByText(/buttonEvent \(top\), right, count 1, RAW/)).toHaveTextContent(
    'Event 1970-01-01T00:01:40.000Z, received 1970-01-01T00:01:41.000Z',
  );
  expect(screen.getByText(/Sequence 17, inner index 12/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Export tap diagnostics' }));
  await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
  expect(exported).toBe(1);
  const contents = await new Promise<string>(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob!);
  });
  expect(JSON.parse(contents)).toEqual({ availability: data.availability, taps: [tap] });
  click.mockRestore();
});

it('shows unavailable monitoring and an empty diagnostic history', () => {
  renderWithProviders(<TapDiagnostics data={ { availability: 'Monitoring unavailable', taps: [] } as unknown as FirmwareSnapshot } />);
  expect(screen.getByText('Monitoring unavailable')).toBeInTheDocument();
  expect(screen.getByText('No recent candidates')).toBeInTheDocument();
});
