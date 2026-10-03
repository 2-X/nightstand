import { useMemo } from 'react';
import { Box } from '@mui/material';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { palette, radius } from '@design/tokens';

// Renders changelog-entry markdown (bold, lists, code spans, links, nothing
// fancier). Sanitized because remote entries come from a raw GitHub fetch;
// local entries are trusted (this repo's own CHANGELOG.md) but there's no
// reason to run two rendering paths for one component.
//
// Nothing here may load a resource from another origin, so images become
// links and the sanitizer only lets through text and link elements.
const markdownParser = new Marked({
  renderer: {
    image({ href, title, text }) {
      return this.link({ href, title, text, raw: text, type: 'link', tokens: [{ type: 'text', raw: text, text: text || href }] });
    },
  },
});

const ALLOWED_TAGS = [
  'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'li', 'ol', 'p', 'pre',
  'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
];

export default function MarkdownBody({ markdown }: { markdown: string }) {
  const html = useMemo(
    () => DOMPurify.sanitize(markdownParser.parse(markdown, { async: false }), { ALLOWED_TAGS, ALLOWED_ATTR: ['href', 'title'] }),
    [markdown],
  );

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
          borderRadius: `${radius.mark}px`,
          px: '4px',
        },
        '& a': { color: palette.text.primary },
        '& strong': { color: palette.text.primary },
        '&& > *:last-child': { mb: 0 },
      } }
    />
  );
}
