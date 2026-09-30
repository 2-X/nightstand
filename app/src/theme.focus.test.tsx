import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tab, Tabs, Button, IconButton, AccordionSummary } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { palette } from '@design/tokens';
import { theme } from './theme';

// jsdom does not track keyboard modality reliably, so the state MUI applies on
// keyboard focus is set directly and the rule that styles it is what's tested.
const focusVisible = 'Mui-focusVisible';

it.each([
  ['a button', <Button key="b" className={ focusVisible }>Turn off</Button>, 'button', 'Turn off'],
  ['an icon button', <IconButton key="i" className={ focusVisible } aria-label="Increase"/>, 'button', 'Increase'],
  ['a tab', <Tabs key="t" value={ 0 }><Tab className={ focusVisible } label="Monday"/></Tabs>, 'tab', 'Monday'],
  ['an accordion summary', <AccordionSummary key="a" className={ focusVisible }>Recovery</AccordionSummary>, 'button', 'Recovery'],
])('outlines %s on keyboard focus with the lamp outline other controls use', (_label, element, role, name) => {
  render(<ThemeProvider theme={ theme }>{ element }</ThemeProvider>);
  const style = getComputedStyle(screen.getByRole(role, { name }));
  expect(style.outline).toBe(`2px solid ${palette.lamp.toLowerCase()}`);
});

it('does not outline a control that is not keyboard focused', () => {
  render(<ThemeProvider theme={ theme }><Button>Turn off</Button></ThemeProvider>);
  expect(getComputedStyle(screen.getByRole('button')).outline).not.toContain('solid');
});
