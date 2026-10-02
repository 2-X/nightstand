const LIMIT = 180;

// A one-line preview of a release's notes: its summary sentence when it has
// one, otherwise its first notes. Headings are skipped, bullets are joined
// with semicolons, and wrapped lines are joined with spaces. Undefined when
// the notes hold nothing to preview.
export function summary(body: string): string | undefined {
  const lines = body.split(/\n\s*\n/).map(block => block.split('\n').filter(line => !/^\s*#/.test(line)).join('\n').trim())
    .find(block => block)?.split('\n') ?? [];
  const items: string[] = [];
  for (const line of lines) {
    const text = line.trim();
    if (/^[-*]\s+/.test(text) || items.length === 0) items.push(text.replace(/^[-*]\s+/, ''));
    else items[items.length - 1] += ` ${text}`;
  }
  const text = items.join('; ').replace(/!\[[^\]]*\]\([^)]*\)\s*/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*`]/g, '').trim();
  if (!text) return undefined;
  const sentence = text.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? text;
  return sentence.length > LIMIT ? `${sentence.slice(0, LIMIT - 1).trimEnd()}…` : sentence;
}
