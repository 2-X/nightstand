import React from 'react';
import Container from '@mui/material/Container';
import { SxProps } from '@mui/material';
import { useTheme } from '@mui/material/styles';


type PageContainerProps = {
  sx?: SxProps
}

export default function PageContainer({ children, sx }: React.PropsWithChildren<PageContainerProps>) {
  const theme = useTheme()

  return (
    <Container
      id='PageContainer'
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        alignItems: 'center',
        gap: 2,
        padding: 6,
        margin: 0,
        width: '100vw',
        justifyContent: 'center',
        [theme.breakpoints.down('sm')]: {
          width: '90%',
          padding: 0,
          paddingTop: 6,

        },
        ...sx,
      }}
    >
      {children}
    </Container>
  );
}
