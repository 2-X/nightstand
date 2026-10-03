import { expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import DeviceInfo from './DeviceInfo';

it('keeps each label whole and lets its value wrap on the right', async () => {
  renderWithProviders(<DeviceInfo/>);
  for (const name of ['Hardware', 'Wi-Fi']) {
    const label = await screen.findByText(name);
    expect(label).toHaveStyle({ whiteSpace: 'nowrap', flexShrink: '0' });
    const value = label.nextElementSibling as HTMLElement;
    expect(value).toHaveStyle({ minWidth: '0', textAlign: 'right' });
  }
});
