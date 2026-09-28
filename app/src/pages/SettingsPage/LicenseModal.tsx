import { useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button } from '@mui/material';
import MarkdownBody from '@components/MarkdownBody';
import license from '../../../../LICENSE.md?raw';

export default function LicenseModal() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={ () => setOpen(true) }>View License and Disclaimer</Button>
      <Dialog open={ open } onClose={ () => setOpen(false) } aria-labelledby="license-title" fullWidth maxWidth="md">
        <DialogTitle id="license-title">License and disclaimer</DialogTitle>
        <DialogContent dividers>
          <MarkdownBody markdown={ license }/>
        </DialogContent>
        <DialogActions>
          <Button onClick={ () => setOpen(false) }>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
