import { PropsWithChildren } from 'react';
import { Typography, Card, CardContent } from '@mui/material';



type SectionProps = PropsWithChildren<{
  title?: string;
}>;

export default function Section({ title, children }: SectionProps) {
  return (
    <Card sx={ { width: '100%', overflowWrap: 'break-word', wordBreak: 'break-word' } }>
      <CardContent>
        {
          title && (
            <>
              <Typography variant='h6' component="h2" sx={ { textAlign: 'left' } }>
                { title }
              </Typography>
              <br />
            </>
          )
        }
        { children }
      </CardContent>
    </Card>
  );
}
