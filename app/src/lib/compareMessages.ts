// Message protocol for Compare mode.
//
// Compare mode is deliberately a simple trick: /compare renders the whole app
// twice in two same-origin iframes, one pinned to each bed side via the
// ?side= query param. Every page then works side-by-side for free, with no
// per-page compare variants. These messages keep the two panes on the same
// route: a pane reports its route changes to the parent, and the parent tells
// the other pane to follow.

export type PinnableSide = 'left' | 'right';

/** A pinned pane -> parent: "my route changed to `path`". */
export const COMPARE_ROUTE_REPORT = 'nightstand-compare-route';
/** Parent -> the other pane: "navigate to `path`". */
export const COMPARE_NAVIGATE = 'nightstand-compare-navigate';

export type CompareMessage = {
  type: typeof COMPARE_ROUTE_REPORT | typeof COMPARE_NAVIGATE;
  path: string;
};

export function isCompareMessage(data: unknown): data is CompareMessage {
  if (typeof data !== 'object' || data === null) return false;
  const candidate = data as Record<string, unknown>;
  return (
    (candidate.type === COMPARE_ROUTE_REPORT || candidate.type === COMPARE_NAVIGATE) &&
    typeof candidate.path === 'string'
  );
}

/** Parse a ?side= pin from a URL search string; null = not pinned. */
export function resolvePinnedSide(search: string): PinnableSide | null {
  const value = new URLSearchParams(search).get('side');
  return value === 'left' || value === 'right' ? value : null;
}
