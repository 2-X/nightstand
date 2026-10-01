import { expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { createDemoRhythms } from '../../../mocks/rhythmsMock';
import MultiDateSheet from './MultiDateSheet';

const left = createDemoRhythms(new Date('2026-09-28T19:00:00Z')).left;

function renderSheet() {
  const onNext = vi.fn();
  const view = renderWithProviders(<MultiDateSheet sideData={ left } today="2026-09-28" onNext={ onNext } onClose={ vi.fn() }/>);
  return { ...view, onNext, sheet: screen.getByRole('dialog', { name: 'Change several dates' }) };
}

const cell = (sheet: HTMLElement, name: string) => within(sheet).getByRole('button', { name });

it('disables dates before today and more than 60 days ahead', async () => {
  const { user, sheet } = renderSheet();
  expect(cell(sheet, 'Sun, Sep 27')).toBeDisabled();
  expect(cell(sheet, 'Mon, Sep 28')).toBeEnabled();
  expect(cell(sheet, 'Mon, Sep 28')).toHaveAttribute('aria-current', 'date');
  expect(cell(sheet, 'Tue, Sep 29')).not.toHaveAttribute('aria-current');
  expect(within(sheet).getByRole('button', { name: 'Previous month' })).toBeDisabled();
  await user.click(within(sheet).getByRole('button', { name: 'Next month' }));
  await user.click(within(sheet).getByRole('button', { name: 'Next month' }));
  expect(screen.getByText('November 2026')).toBeInTheDocument();
  expect(cell(sheet, 'Fri, Nov 27')).toBeEnabled();
  expect(cell(sheet, 'Sat, Nov 28')).toBeDisabled();
  expect(within(sheet).getByRole('button', { name: 'Next month' })).toBeDisabled();
});

it('moves focus by a day and a week with the arrow keys, across months', async () => {
  const { user, sheet } = renderSheet();
  cell(sheet, 'Mon, Sep 28').focus();
  await user.keyboard('{ArrowRight}');
  expect(cell(sheet, 'Tue, Sep 29')).toHaveFocus();
  await user.keyboard('{ArrowDown}');
  expect(cell(sheet, 'Tue, Oct 6')).toHaveFocus();
  expect(screen.getByText('October 2026')).toBeInTheDocument();
  await user.keyboard('{ArrowUp}{ArrowLeft}');
  expect(cell(sheet, 'Mon, Sep 28')).toHaveFocus();
  await user.keyboard('{ArrowLeft}');
  expect(cell(sheet, 'Mon, Sep 28')).toHaveFocus();
});

it('toggles dates with Space and counts them', async () => {
  const { user, sheet, onNext } = renderSheet();
  expect(within(sheet).getByRole('status')).toHaveTextContent('No dates selected');
  expect(within(sheet).getByRole('button', { name: 'Choose a rhythm' })).toBeDisabled();
  cell(sheet, 'Mon, Sep 28').focus();
  await user.keyboard(' ');
  expect(cell(sheet, 'Mon, Sep 28')).toHaveAttribute('aria-pressed', 'true');
  expect(within(sheet).getByRole('status')).toHaveTextContent('1 date selected');
  await user.keyboard('{ArrowRight}{ArrowRight} ');
  expect(within(sheet).getByRole('status')).toHaveTextContent('2 dates selected');
  await user.keyboard('{ArrowLeft}{ArrowLeft} ');
  expect(within(sheet).getByRole('status')).toHaveTextContent('1 date selected');
  await user.click(within(sheet).getByRole('button', { name: 'Choose a rhythm' }));
  expect(onNext).toHaveBeenCalledWith(['2026-09-30']);
});

it('marks a date that is already changed', () => {
  const { sheet } = renderSheet();
  expect(cell(sheet, 'Wed, Sep 30, changed')).toBeInTheDocument();
  expect(cell(sheet, 'Tue, Sep 29')).toBeInTheDocument();
  expect(within(sheet).getByText('A dot marks a date that is already changed.')).toBeInTheDocument();
});
