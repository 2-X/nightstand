import { Button, CircularProgress } from '@mui/material';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Slide from '@mui/material/Slide';
import { TransitionProps } from '@mui/material/transitions';
import { useState, forwardRef, type ReactElement, type Ref } from 'react';
import currentServerInfo from '../../../../../server/src/serverInfo.json';

import { postJobs } from '@api/jobs.ts';
import { useServerInfo } from '@api/serverInfo.ts';


const Transition = forwardRef(function Transition(
  props: TransitionProps & {
    children: ReactElement<any, any>;
  },
  ref: Ref<unknown>,
) {
  return <Slide direction="up" ref={ ref } { ...props } />;
});

// eslint-disable-next-line react/no-multi-comp
export default function UpdateFreeSleepButton() {
  const [open, setOpen] = useState(false);
  const { data: serverInfo } = useServerInfo();
  const [isUpdating, setIsUpdating] = useState(false);

  const handleClickOpen = () => {
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
  };

  const update = () => {
    setIsUpdating(true);
    postJobs(['update'])
      .catch(error => {
        console.error(error);
      });
  };

  return (
    <>
      <Button variant="outlined" onClick={ handleClickOpen } size="small" sx={ { width: '150px' } }>
        Update free sleep
      </Button>
      <Dialog
        open={ open }
        slots={ {
          transition: Transition,
        } }
        keepMounted
        onClose={ handleClose }
      >
        {
          isUpdating ?
            <DialogTitle>Updating Free Sleep...</DialogTitle>
            :
            <DialogTitle>Update Free Sleep?</DialogTitle>
        }

        <DialogContent>
          {
            isUpdating ?
              (
                <>
                  <DialogContentText>
                    Updating from { currentServerInfo.version } to { serverInfo?.version }.
                    This page will be unavailable until update is complete.
                    &nbsp;<CircularProgress size={ 20 }/>
                  </DialogContentText>
                </>
              )
              :
              (
                <DialogContentText>
                  Update from { currentServerInfo.version } to { serverInfo?.version }?
                  This should take about 3 minutes.
                  This website will be unavailable during the update.
                </DialogContentText>
              )
          }

        </DialogContent>
        {
          isUpdating ?
            (
              <DialogActions>
                <Button onClick={ handleClose }>Close</Button>
              </DialogActions>

            )
            :
            (
              <DialogActions>
                <Button onClick={ handleClose }>Cancel</Button>
                <Button onClick={ update }>Confirm</Button>
              </DialogActions>
            )
        }

      </Dialog>
    </>
  );
}
