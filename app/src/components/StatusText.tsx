import { useEffect, useState } from 'react';
import { Typography, type TypographyProps } from '@mui/material';

// A status region that is in the page before its text, since some screen readers do not announce a region that
// arrives already filled.
export default function StatusText({ children, ...props }: Omit<TypographyProps, 'role'>) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <Typography { ...props } role="status">{ mounted ? children : null }</Typography>;
}
