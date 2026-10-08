import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ButtonEventMachine } from './buttonEvents.js';

describe('ButtonEventMachine', () => {
  it('makes one click of a press and its release', () => {
    const machine = new ButtonEventMachine();
    assert.deepEqual(machine.push('[tca8418R] gpi press 97'), []);
    assert.deepEqual(machine.push('[tca8418R] gpi release 97'), [
      { side: 'right', button: 'top', kind: 'click' },
    ]);
  });

  it('maps codes 97, 98 and 99 to top, middle and bottom, and R and L to the sides', () => {
    const machine = new ButtonEventMachine();
    machine.push('[tca8418L] gpi press 98');
    assert.deepEqual(machine.push('[tca8418L] gpi release 98'), [
      { side: 'left', button: 'middle', kind: 'click' },
    ]);
    machine.push('[tca8418L] gpi press 99');
    assert.deepEqual(machine.push('[tca8418L] gpi release 99'), [
      { side: 'left', button: 'bottom', kind: 'click' },
    ]);
  });

  it('collapses repeated press lines while held into one click', () => {
    const machine = new ButtonEventMachine();
    machine.push('[tca8418R] gpi press 97');
    machine.push('[tca8418R] gpi press 97');
    machine.push('[tca8418R] gpi press 97');
    assert.deepEqual(machine.push('[tca8418R] gpi release 97'), [{ side: 'right', button: 'top', kind: 'click' }]);
  });

  it('ignores a release without a press', () => {
    const machine = new ButtonEventMachine();
    assert.deepEqual(machine.push('[tca8418R] gpi release 97'), []);
  });

  it('swallows the click when the older firmware aborts a hold before the release', () => {
    const machine = new ButtonEventMachine();
    machine.push('[tca8418R] gpi press 97');
    assert.deepEqual(machine.push('[buttons] top button held for 320ms (abort)'), []);
    assert.deepEqual(machine.push('[tca8418R] gpi release 97'), []);
  });

  it('makes a hold, not a click, of a completed hold', () => {
    const machine = new ButtonEventMachine();
    machine.push('[tca8418L] gpi press 98');
    assert.deepEqual(machine.push('[buttons] middle button held for 160ms'), [
      { side: 'left', button: 'middle', kind: 'hold' },
    ]);
    assert.deepEqual(machine.push('[tca8418L] gpi release 98'), []);
  });

  // The newer host firmware's lines, as archived from a Pod 4 hub with a
  // Pod 5 cover: the long press is announced while the button is down and the
  // firmware acts on it, so the release must not become a second step.
  it('swallows the release after the newer firmware announces a long press', () => {
    const machine = new ButtonEventMachine();
    assert.deepEqual(machine.push('[tca8418R] gpi press 97'), []);
    assert.deepEqual(machine.push('[buttons] top button clicked'), []);
    assert.deepEqual(machine.push('[buttons] long press top: 500ms'), [
      { side: 'right', button: 'top', kind: 'hold' },
    ]);
    assert.deepEqual(machine.push('[buttons] sent button event s0x01 i0x80 c0x01'), []);
    assert.deepEqual(machine.push('[tca8418R] gpi release 97'), []);
    assert.deepEqual(machine.push('[buttons] top button released'), []);
  });

  it('still makes a click of a short press whose abort line follows the release', () => {
    const machine = new ButtonEventMachine();
    machine.push('[tca8418L] gpi press 99');
    machine.push('[buttons] bottom button clicked');
    assert.deepEqual(machine.push('[tca8418L] gpi release 99'), [
      { side: 'left', button: 'bottom', kind: 'click' },
    ]);
    assert.deepEqual(machine.push('[buttons] bottom button released'), []);
    assert.deepEqual(machine.push('[buttons] bottom button held for 256ms (abort)'), []);
  });

  it('ignores a long press line without a press', () => {
    const machine = new ButtonEventMachine();
    assert.deepEqual(machine.push('[buttons] long press bottom: 500ms'), []);
  });

  it('ignores unknown keypad codes and other lines', () => {
    const machine = new ButtonEventMachine();
    assert.deepEqual(machine.push('[tca8418R] gpi press 42'), []);
    assert.deepEqual(machine.push('[TTC] ignoring 1 short clicks'), []);
  });

  it('keeps the sides apart', () => {
    const machine = new ButtonEventMachine();
    machine.push('[tca8418R] gpi press 97');
    machine.push('[tca8418L] gpi press 97');
    assert.deepEqual(machine.push('[tca8418L] gpi release 97'), [{ side: 'left', button: 'top', kind: 'click' }]);
    assert.deepEqual(machine.push('[tca8418R] gpi release 97'), [{ side: 'right', button: 'top', kind: 'click' }]);
  });
});
