import React from 'react';
import { Container, ContainerProps } from '@mui/material';
import { SxProps } from '@mui/material';
import ErrorBoundary from '@components/ErrorBoundary.tsx';


type PageContainerProps = {
  containerProps?: ContainerProps;
  sx?: SxProps
}

export default function PageContainer({ children, sx, containerProps }: React.PropsWithChildren<PageContainerProps>) {

  return (
    <ErrorBoundary componentName='Page container'>
      <Container
        { ...containerProps }
        id='PageContainer'
        maxWidth={ false }
        sx={ {
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          alignItems: 'center',
          gap: 2,
          mx: 'auto',
          width: '100%',
          maxWidth: 720,
          padding: { xs: 2, sm: 3 },
          justifyContent: 'flex-start',
          ...sx,
        } }
      >
        { children }
      </Container>
    </ErrorBoundary>
  );
}
