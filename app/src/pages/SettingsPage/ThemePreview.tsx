import { Box } from '@mui/material';
import { THEMES } from '@design/themes';
import type { ThemeId } from '@design/themes/ids';

type ThemePreviewProps = { id: ThemeId };

// A small card in the look's own colours and corner, halved to fit. It shows no value, so no scale colours.
export default function ThemePreview({ id }: ThemePreviewProps) {
  const { palette: p, radius } = THEMES[id];
  return <Box
    component="span"
    aria-hidden="true"
    data-theme-preview={ id }
    sx={ {
      display: 'inline-flex', flex: 'none', width: 56, height: 40, p: '6px', boxSizing: 'border-box',
      bgcolor: p.bg.base, border: `1px solid ${p.border.control}`, borderRadius: `${Math.round(radius / 2)}px`,
    } }>
    <Box
      component="span"
      sx={ {
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1, p: '5px', boxSizing: 'border-box',
        bgcolor: p.bg.elevated, border: `1px solid ${p.border.subtle}`, borderRadius: `${Math.round(radius / 3)}px`,
      } }>
      <Box component="span" sx={ { display: 'block', width: 22, height: 4, bgcolor: p.text.primary } }/>
      <Box component="span" sx={ { display: 'block', width: 12, height: 6, bgcolor: p.accent, borderRadius: `${Math.round(radius / 4)}px` } }/>
    </Box>
  </Box>;
}
