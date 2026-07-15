import { useMemo } from 'react';
import { Box } from '@mui/material';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { palette } from '@design/tokens';

// Renders changelog-entry markdown (bold, lists, code spans, links, nothing
// fancier). Sanitized because remote entries come from a raw GitHub fetch;
// local entries are trusted (this repo's own CHANGELOG.md) but there's no
// reason to run two rendering paths for one component.
export default function MarkdownBody({ markdown }: { markdown: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(markdown, { async: false }) as string), [markdown]);

  return (
    <Box
      dangerouslySetInnerHTML={ { __html: html } }
      sx={ {
        fontSize: '0.875rem',
        color: palette.text.secondary,
        '& p': { m: 0, mb: 1 },
        '& ul, & ol': { m: 0, mb: 1, pl: 3 },
        '& li': { mb: 0.25 },
        '& code': {
          fontFamily: 'monospace',
          fontSize: '0.8em',
          backgroundColor: palette.bg.hover,
          borderRadius: '4px',
          px: '4px',
        },
        '& a': { color: palette.text.primary },
        '& strong': { color: palette.text.primary },
        '&& > *:last-child': { mb: 0 },
      } }
    />
  );
}
