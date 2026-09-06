// Pure state machine that turns the Pod cover's raw log lines into debounced,
// classified button events. No I/O; buttonMonitor.ts feeds it log `msg`
// strings in file order and consumes the emitted events.
//
// Grammar observed in the RAW capture (biometrics forensics):
//   [tca8418R] gpi press 97      (R|L = side; codes 97/98/99 = top/middle/bottom)
//   [tca8418R] gpi release 97
//   [buttons] top button held for 320ms (abort)      -> long-hold, suppress click
//   [buttons] middle button held for 176ms (abort)
//   [buttons] middle button held for 160ms           -> completed hold (no abort)
//
// Raw press/release lines can repeat while a button is held; we debounce to one
// event per press edge. A press+release pair collapses to a single `click`. A
// `[buttons] ... (abort)` for a button currently held suppresses that click. A
// `[buttons] ... held for Nms` WITHOUT (abort) emits a `hold`.
// TCA8418 GPI code -> physical button position. Findings: codes 97/98/99 are
// the three buttons in physical order (+ / logo / -). We map them to
// top/middle/bottom here; the +/- meaning of top vs bottom is resolved later
// via the per-side invertButtons config, NOT here.
const CODE_TO_BUTTON = {
    97: 'top',
    98: 'middle',
    99: 'bottom',
};
const PRESS_RE = /\[tca8418([RL])\]\s+gpi\s+(press|release)\s+(\d+)/i;
const HELD_RE = /\[buttons\]\s+(top|middle|bottom)\s+button\s+held\s+for\s+(\d+)ms\s*(\(abort\))?/i;
export class ButtonEventMachine {
    pending = new Map();
    static key(side, button) {
        return `${side}:${button}`;
    }
    /**
     * Feed one raw log message. Returns any button events it completed (usually
     * zero or one). Unrecognized lines return [].
     */
    push(msg) {
        const press = PRESS_RE.exec(msg);
        if (press)
            return this.onPressLine(press);
        const held = HELD_RE.exec(msg);
        if (held)
            return this.onHeldLine(held);
        return [];
    }
    onPressLine(m) {
        const side = m[1].toUpperCase() === 'L' ? 'left' : 'right';
        const edge = m[2].toLowerCase();
        const code = Number(m[3]);
        const button = CODE_TO_BUTTON[code];
        if (!button)
            return []; // unknown GPI code
        const key = ButtonEventMachine.key(side, button);
        if (edge === 'press') {
            // Debounce: repeated press lines while held collapse to the first.
            const existing = this.pending.get(key);
            if (existing?.down)
                return [];
            this.pending.set(key, { down: true, suppressed: false });
            return [];
        }
        // release
        const state = this.pending.get(key);
        this.pending.delete(key);
        if (!state?.down)
            return []; // release without a tracked press (already consumed)
        if (state.suppressed)
            return []; // a hold-abort ate this click
        return [{ side, button, kind: 'click' }];
    }
    onHeldLine(m) {
        const button = m[1].toLowerCase();
        const aborted = Boolean(m[3]);
        // The [buttons] line carries no side. Correlate to the most recent still-
        // down press of this button across sides. Single-user, one-button-at-a-time
        // is the normal case; if both sides somehow hold the same button at once we
        // apply to whichever we find (arbitrary but bounded).
        const side = this.findDownSide(button);
        if (aborted) {
            // Long-hold abort: suppress the click that the release would otherwise
            // emit. If we have a matching pending press, mark it; otherwise nothing
            // to do (the release may have already fired, in which case there is no
            // safe retraction - but abort lines precede release in practice).
            if (side) {
                const key = ButtonEventMachine.key(side, button);
                const state = this.pending.get(key);
                if (state)
                    state.suppressed = true;
            }
            return [];
        }
        // Completed hold (no abort): emit a hold event, and suppress the pending
        // click so the release doesn't double-fire.
        if (side) {
            const key = ButtonEventMachine.key(side, button);
            const state = this.pending.get(key);
            if (state)
                state.suppressed = true;
            return [{ side, button, kind: 'hold' }];
        }
        return [];
    }
    findDownSide(button) {
        for (const side of ['left', 'right']) {
            const state = this.pending.get(ButtonEventMachine.key(side, button));
            if (state?.down)
                return side;
        }
        return null;
    }
}
/**
 * Detects middle-button double-clicks per side. The first middle click is held
 * pending until either the window elapses (then it's a lone single click - but
 * middle single-click is a no-op in the mapping, so callers can ignore it) or a
 * second middle click arrives (double-click -> dismiss).
 *
 * `now` is injected so tests are deterministic.
 */
export class DoubleClickDetector {
    windowMs;
    lastMiddleClickAt = {};
    constructor(windowMs) {
        this.windowMs = windowMs;
    }
    setWindow(windowMs) {
        this.windowMs = windowMs;
    }
    feed(event, now) {
        // Only middle clicks participate in double-click detection.
        if (event.button !== 'middle' || event.kind !== 'click') {
            return { singleClick: event };
        }
        const last = this.lastMiddleClickAt[event.side];
        if (last !== undefined && now - last <= this.windowMs) {
            // Second click within the window: double-click. Consume the pending
            // first click (don't emit it as a single).
            this.lastMiddleClickAt[event.side] = undefined;
            return { doubleClick: { side: event.side } };
        }
        // First middle click (or window expired): arm and emit nothing yet. Middle
        // single-click is a no-op in the mapping, so there's no pending single to
        // flush later.
        this.lastMiddleClickAt[event.side] = now;
        return {};
    }
}
//# sourceMappingURL=buttonEvents.js.map