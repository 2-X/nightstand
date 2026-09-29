import { Typography, type TypographyProps } from '@mui/material';

type SectionHeadingProps = Omit<TypographyProps<'h2'>, 'component' | 'variant'>;

export default function SectionHeading(props: SectionHeadingProps) {
  return <Typography { ...props } component="h2" variant="h2"/>;
}
