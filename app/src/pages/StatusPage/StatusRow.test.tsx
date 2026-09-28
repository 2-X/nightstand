import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import StatusRow from './StatusRow';

const status = {
  name: 'Analyze sleep left', status: 'healthy', description: '', message: '', timestamp: '2026-09-28T06:00:00Z',
} as const;

describe('manual diagnostic jobs', () => {
  it('reports a rejected job and enables retry immediately', async () => {
    server.use(http.post('*/jobs', () => new HttpResponse(null, { status: 500 })));
    const { user } = renderWithProviders(<StatusRow job="analyzeSleepLeft" statusInfo={ status } divider={ false }/>);
    await user.click(screen.getByRole('button', { name: 'Analyze left-side sleep' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not start');
    expect(screen.getByRole('button', { name: 'Analyze left-side sleep' })).toBeEnabled();
  });
  it('reports acceptance without claiming completion from the POST alone', async () => {
    server.use(http.post('*/jobs', () => new HttpResponse(null, { status: 204 })));
    const { user } = renderWithProviders(<StatusRow job="analyzeSleepLeft" statusInfo={ status } divider={ false }/>);
    await user.click(screen.getByRole('button', { name: 'Analyze left-side sleep' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Request accepted');
    expect(screen.getByRole('status')).not.toHaveTextContent('Completed');
  });
  it('requires an empty-side confirmation before manual calibration', async () => {
    let posted = false;
    server.use(http.post('*/jobs', () => { posted = true; return new HttpResponse(null, { status: 204 }); }));
    const { user } = renderWithProviders(<StatusRow job="biometricsCalibrationLeft" statusInfo={ status } divider={ false }/>);
    await user.click(screen.getByRole('button', { name: 'Calibrate left presence' }));
    const dialog = await screen.findByRole('dialog', { name: 'Calibrate left presence?' });
    expect(dialog).toHaveTextContent('Keep the left side empty');
    expect(posted).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Calibrate left presence' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Request accepted');
  });
});


it('labels the Web server timestamp as its startup time', () => {
  renderWithProviders(<StatusRow job="express" statusInfo={ { ...status, name: 'Express' } } divider={ false }/>);
  expect(screen.getByText(/^Started .+/)).toBeVisible();
});
