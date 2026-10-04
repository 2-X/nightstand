/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import type { Page } from '@playwright/test';

// Runs in the page. Returns readable problems: sideways scroll, content past
// the right edge, overlapping text or controls, words broken mid-word, and
// guarded labels that leave their safe area.
export async function probeLayout(page: Page): Promise<string[]> {
  // A phone widens its layout viewport to fit content that overflows, so measure against the set width.
  return page.evaluate(viewportWidth => {
    const problems: string[] = [];
    const width = viewportWidth ?? window.innerWidth;
    const describe = (el: Element) => `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 40)}"`;
    const visible = (el: Element) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    const scrollWidth = document.documentElement.scrollWidth;
    if (scrollWidth > width) problems.push(`page scrolls sideways (${scrollWidth} > ${width})`);

    const leaves = [...document.querySelectorAll([
      'button, a, input, select, textarea, [role="button"], [role="radio"], [role="tab"], [role="switch"]',
      'h1, h2, h3, h4, h5, h6, p, span, label, li',
    ].join(', '))]
      .filter(el => visible(el) && ((el.textContent ?? '').trim() || el.matches('input, select, textarea'))
        && ![...el.children].some(child => (child.textContent ?? '').trim()));
    for (const el of leaves) {
      const rect = el.getBoundingClientRect();
      if (rect.right > width + 1) problems.push(`${describe(el)} ends past the right edge`);
    }
    const fixedLayer = (el: Element) => {
      for (let node: Element | null = el; node; node = node.parentElement) if (getComputedStyle(node).position === 'fixed') return true;
      return false;
    };
    // A sticky header or footer is its own layer: content scrolls under it by design.
    const stickyRoot = (el: Element) => {
      for (let node: Element | null = el; node; node = node.parentElement) if (getComputedStyle(node).position === 'sticky') return node;
      return null;
    };
    // The part of an element its scrolling ancestors leave on screen.
    const shownRect = (el: Element) => {
      const rect = el.getBoundingClientRect();
      let { left, top, right, bottom } = rect;
      for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
        const clip = node.getBoundingClientRect();
        left = Math.max(left, clip.left);
        top = Math.max(top, clip.top);
        right = Math.min(right, clip.right);
        bottom = Math.min(bottom, clip.bottom);
      }
      return { left, top, right, bottom };
    };
    // While a modal is open only its own content is compared; what it covers cannot be seen or reached.
    const modals = [...document.querySelectorAll('[role="dialog"][aria-modal="true"], .MuiModal-root:not(.MuiModal-hidden)')]
      .filter(visible);
    const onTop = leaves.filter(el => !el.closest('[inert]') && (!modals.length || modals.some(modal => modal.contains(el))));
    // An empty, unfocused field's floating label rests over its own input.
    const restingLabel = (label: Element, field: Element) => label instanceof HTMLLabelElement && label.control === field
      && (field as HTMLInputElement).value === '' && document.activeElement !== field;
    for (let i = 0; i < onTop.length; i++) {
      for (let j = i + 1; j < onTop.length; j++) {
        const a = onTop[i];
        const b = onTop[j];
        if (a.contains(b) || b.contains(a) || fixedLayer(a) !== fixedLayer(b) || stickyRoot(a) !== stickyRoot(b)) continue;
        if (restingLabel(a, b) || restingLabel(b, a)) continue;
        const ra = shownRect(a);
        const rb = shownRect(b);
        const x = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const y = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (x > 2 && y > 2) problems.push(`${describe(a)} overlaps ${describe(b)}`);
      }
    }

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || !visible(parent) || parent.closest('[data-allow-break], pre, code')) continue;
      const text = node.textContent ?? '';
      // A compound may wrap after its hyphen; a break inside either part is still caught.
      for (const match of text.matchAll(/[^\s\-\u2010\u2011]+/g)) {
        if (match[0].length > 20) continue;
        const range = document.createRange();
        range.setStart(node, match.index!);
        range.setEnd(node, match.index! + match[0].length);
        const lines = new Set([...range.getClientRects()].map(rect => Math.round(rect.top)));
        if (lines.size > 1) problems.push(`"${match[0]}" breaks across lines in ${describe(parent)}`);
      }
    }

    for (const label of document.querySelectorAll('[data-layout-guard="arc"]')) {
      const ring = label.closest('[data-layout-arc-root]')?.querySelector('[data-layout-arc]') ?? document.querySelector('[data-layout-arc]');
      if (!ring || !visible(label)) continue;
      const box = ring.getBoundingClientRect();
      const stroke = Number.parseFloat(getComputedStyle(ring).strokeWidth || '0');
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      const inner = box.width / 2 - stroke;
      const rect = label.getBoundingClientRect();
      for (const y of [rect.top, rect.bottom]) {
        const half = Math.sqrt(Math.max(0, inner * inner - (y - cy) * (y - cy)));
        if (rect.left < cx - half - 1 || rect.right > cx + half + 1) problems.push(`${describe(label)} crosses the dial ring`);
      }
    }
    return [...new Set(problems)];
  }, page.viewportSize()?.width);
}
