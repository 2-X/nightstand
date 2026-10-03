import type { SxProps, Theme } from '@mui/material';
import { radius } from '@design/tokens';

// A dialog that rises from the bottom edge, as the pickers on this screen do.
export const BOTTOM_SHEET: SxProps<Theme> = {
  '& .MuiDialog-container': { alignItems: 'flex-end' },
  '& .MuiDialog-paper': { m: 0, width: '100%', borderRadius: `${radius.base}px ${radius.base}px 0 0` },
};

// Controls use aria-disabled, not disabled, while a save runs, so focus can come back to them.
export const INACTIVE = { '&[aria-disabled="true"]': { opacity: 0.6 } } as const;
