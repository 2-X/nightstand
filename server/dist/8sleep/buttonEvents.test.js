import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ButtonEventMachine, DoubleClickDetector, } from './buttonEvents.js';
describe('ButtonEventMachine', () => {
    it('emits one click on a press+release pair', () => {
        const m = new ButtonEventMachine();
        assert.deepEqual(m.push('[tca8418R] gpi press 97'), []);
        assert.deepEqual(m.push('[tca8418R] gpi release 97'), [
            { side: 'right', button: 'top', kind: 'click' },
        ]);
    });
    it('maps codes 97/98/99 to top/middle/bottom and R/L to side', () => {
        const m = new ButtonEventMachine();
        m.push('[tca8418L] gpi press 98');
        assert.deepEqual(m.push('[tca8418L] gpi release 98'), [
            { side: 'left', button: 'middle', kind: 'click' },
        ]);
        m.push('[tca8418L] gpi press 99');
        assert.deepEqual(m.push('[tca8418L] gpi release 99'), [
            { side: 'left', button: 'bottom', kind: 'click' },
        ]);
    });
    it('debounces repeated press lines while held to a single click', () => {
        const m = new ButtonEventMachine();
        m.push('[tca8418R] gpi press 97');
        m.push('[tca8418R] gpi press 97'); // repeat while held
        m.push('[tca8418R] gpi press 97');
        const out = m.push('[tca8418R] gpi release 97');
        assert.deepEqual(out, [{ side: 'right', button: 'top', kind: 'click' }]);
    });
    it('ignores a release with no tracked press', () => {
        const m = new ButtonEventMachine();
        assert.deepEqual(m.push('[tca8418R] gpi release 97'), []);
    });
    it('suppresses the click when a hold-abort arrives before release', () => {
        const m = new ButtonEventMachine();
        m.push('[tca8418R] gpi press 97');
        assert.deepEqual(m.push('[buttons] top button held for 320ms (abort)'), []);
        // The release must NOT produce a click now.
        assert.deepEqual(m.push('[tca8418R] gpi release 97'), []);
    });
    it('emits a hold (not a click) on a completed hold without abort', () => {
        const m = new ButtonEventMachine();
        m.push('[tca8418L] gpi press 98');
        assert.deepEqual(m.push('[buttons] middle button held for 160ms'), [
            { side: 'left', button: 'middle', kind: 'hold' },
        ]);
        // The trailing release does not double-fire.
        assert.deepEqual(m.push('[tca8418L] gpi release 98'), []);
    });
    // Newer host firmware grammar, taken verbatim from the NAS RAW archive
    // (Oct 6 2026, 07:51 ET). A long press is announced while the button is
    // still down and the firmware applies it itself; the release must not
    // become a second application.
    it('swallows the release after a firmware long-press line (new grammar)', () => {
        const m = new ButtonEventMachine();
        assert.deepEqual(m.push('[tca8418R] gpi press 97'), []);
        assert.deepEqual(m.push('[buttons] top button clicked'), []);
        assert.deepEqual(m.push('[buttons] long press top: 500ms'), [
            { side: 'right', button: 'top', kind: 'hold' },
        ]);
        assert.deepEqual(m.push('[buttons] sent button event s0x01 i0x80 c0x01'), []);
        assert.deepEqual(m.push('[tca8418R] gpi release 97'), []);
        assert.deepEqual(m.push('[buttons] top button released'), []);
    });
    it('still emits a click for a short press whose (abort) line trails the release', () => {
        const m = new ButtonEventMachine();
        m.push('[tca8418L] gpi press 99');
        m.push('[buttons] bottom button clicked');
        assert.deepEqual(m.push('[tca8418L] gpi release 99'), [
            { side: 'left', button: 'bottom', kind: 'click' },
        ]);
        assert.deepEqual(m.push('[buttons] bottom button released'), []);
        // Arrives after the release on the new firmware; must be a no-op, not a
        // retroactive suppression and not a second event.
        assert.deepEqual(m.push('[buttons] bottom button held for 256ms (abort)'), []);
    });
    it('ignores a long-press line with no tracked press', () => {
        const m = new ButtonEventMachine();
        assert.deepEqual(m.push('[buttons] long press bottom: 500ms'), []);
    });
    it('ignores unknown GPI codes and unrelated lines', () => {
        const m = new ButtonEventMachine();
        assert.deepEqual(m.push('[tca8418R] gpi press 42'), []);
        assert.deepEqual(m.push('[some other] noise'), []);
    });
    it('keeps left and right presses independent', () => {
        const m = new ButtonEventMachine();
        m.push('[tca8418R] gpi press 97');
        m.push('[tca8418L] gpi press 97');
        assert.deepEqual(m.push('[tca8418L] gpi release 97'), [
            { side: 'left', button: 'top', kind: 'click' },
        ]);
        assert.deepEqual(m.push('[tca8418R] gpi release 97'), [
            { side: 'right', button: 'top', kind: 'click' },
        ]);
    });
});
describe('DoubleClickDetector', () => {
    const middle = (side) => ({ side, button: 'middle', kind: 'click' });
    it('passes top/bottom clicks straight through as single clicks', () => {
        const d = new DoubleClickDetector(2000);
        const ev = { side: 'right', button: 'top', kind: 'click' };
        assert.deepEqual(d.feed(ev, 1000), { singleClick: ev });
    });
    it('emits a double-click when two middle clicks fall within the window', () => {
        const d = new DoubleClickDetector(2000);
        assert.deepEqual(d.feed(middle('right'), 1000), {}); // first: armed, nothing yet
        assert.deepEqual(d.feed(middle('right'), 2500), { doubleClick: { side: 'right' } });
    });
    it('does not double-click when the second middle click is too late', () => {
        const d = new DoubleClickDetector(2000);
        assert.deepEqual(d.feed(middle('right'), 1000), {});
        // 2100ms later > 2000ms window: this re-arms as a fresh first click.
        assert.deepEqual(d.feed(middle('right'), 3200), {});
        // A third within window of the second does complete a double-click.
        assert.deepEqual(d.feed(middle('right'), 4000), { doubleClick: { side: 'right' } });
    });
    it('tracks the two sides independently', () => {
        const d = new DoubleClickDetector(2000);
        d.feed(middle('left'), 1000);
        d.feed(middle('right'), 1500);
        // Left completes; right stays pending.
        assert.deepEqual(d.feed(middle('left'), 2000), { doubleClick: { side: 'left' } });
        assert.deepEqual(d.feed(middle('right'), 5000), {}); // too late, re-armed
    });
    it('honors a window change via setWindow', () => {
        const d = new DoubleClickDetector(500);
        d.feed(middle('right'), 1000);
        assert.deepEqual(d.feed(middle('right'), 1400), { doubleClick: { side: 'right' } });
        d.setWindow(100);
        d.feed(middle('right'), 2000);
        assert.deepEqual(d.feed(middle('right'), 2300), {}); // 300 > 100 window
    });
});
//# sourceMappingURL=buttonEvents.test.js.map