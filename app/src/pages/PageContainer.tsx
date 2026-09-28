import React from 'react';
import { Container, ContainerProps } from '@mui/material';
import { SxProps } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ErrorBoundary from '@components/ErrorBoundary.tsx';


type PageContainerProps = {
  containerProps?: ContainerProps;
  sx?: SxProps
}

export default function PageContainer({ children, sx, containerProps }: React.PropsWithChildren<PageContainerProps>) {
  const theme = useTheme();

  return (
    <ErrorBoundary componentName='Page container'>
      <Container
        { ...containerProps }
        id='PageContainer'
        sx={ {
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          alignItems: 'center',
          gap: 2,
          margin: 0,
          justifyContent: 'flex-start',
          [theme.breakpoints.up('sm')]: {
            width: '100%',
            padding: 3,
            maxWidth: '960px',
          },
          [theme.breakpoints.down('sm')]: {
            width: '100%',
            padding: 2,
          },
          ...sx,
        } }
      >
        { children }
      </Container>
    </ErrorBoundary>
  );
}
