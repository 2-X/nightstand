import { expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { createDemoRhythms } from '../../../mocks/rhythmsMock';
import RhythmList from './RhythmList';

const left = createDemoRhythms(new Date('2026-09-28T19:00:00Z')).left;

it('describes each rhythm and opens it', async () => {
  const onOpen = vi.fn();
  const { user } = renderWithProviders(<RhythmList
    sideData={ left }
    today="2026-09-28"
    disabled={ false }
    onOpen={ onOpen }
    onNew={ () => {} }
    onUse={ () => {} }/>);
  const workday = screen.getByRole('button', { name: 'Edit Workday' });
  expect(workday).toHaveTextContent('10:30 PM to 6:45 AM · Smart Schedule');
  expect(workday).toHaveTextContent('Used on Sun to Thu');
  await user.click(workday);
  expect(onOpen).toHaveBeenCalledWith('workday');
});

it('stops at twelve rhythms per side', () => {
  const rhythms = Object.fromEntries(Array.from({ length: 12 }, (_, index) =>
    [`r-${index}`, { ...left.rhythms.weekend, id: `r-${index}`, name: `Rhythm ${index}` }]));
  renderWithProviders(<RhythmList
    sideData={ { ...left, rhythms } }
    today="2026-09-28"
    disabled={ false }
    onOpen={ () => {} }
    onNew={ () => {} }
    onUse={ () => {} }/>);
  expect(screen.getByRole('button', { name: 'New rhythm' })).toBeDisabled();
  expect(screen.getByText('A side can have up to 12 rhythms.')).toBeInTheDocument();
});
