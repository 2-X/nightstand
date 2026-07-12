import { Component, type ErrorInfo as ReactErrorInfo, type PropsWithChildren } from 'react';
import { Alert, Typography } from '@mui/material';


type CaughtError = {
  error: Error;
  componentStack: string;
}

type ErrorMessageProps = {
  componentName: string;
  errorInfo?: CaughtError;
}


const ErrorMessage = ({ componentName, errorInfo }: ErrorMessageProps) => {
  if (errorInfo && import.meta.env.VITE_ENV === 'dev') {
    const errorMessage =
      errorInfo?.error instanceof Error
        ? errorInfo.error.message
        : typeof errorInfo?.error === 'string'
          ? errorInfo.error
          : '';

    return (
      <Alert severity='error'>

        <Typography color='text.secondary' sx={ { fontFamily: 'monospace' } }>
          ERROR: &nbsp;
          { errorMessage }
          <br />
          { errorInfo.componentStack }
        </Typography>
      </Alert>

    );
  } else {
    return (
      <Alert severity='error'>
        { componentName } failed to load
      </Alert>
    );
  }
};

type ErrorBoundaryProps = PropsWithChildren<Pick<ErrorMessageProps, 'componentName'>>;

type ErrorBoundaryState = {
  errorInfo?: CaughtError;
}

// Plain React error boundary (class component because React only exposes
// componentDidCatch through the class API).
// eslint-disable-next-line react/no-multi-comp
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {};

  componentDidCatch(error: Error, info: ReactErrorInfo) {
    this.setState({ errorInfo: { error, componentStack: info.componentStack ?? '' } });
  }

  render() {
    if (this.state.errorInfo) {
      return (
        <ErrorMessage
          componentName={ this.props.componentName }
          errorInfo={ this.state.errorInfo }
        />
      );
    }
    return this.props.children;
  }
}
