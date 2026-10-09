import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ButtonEventMachine } from './buttonEvents.js';

const topRight = { side: 'right', button: 'top', kind: 'click' };
const bottomLeft = { side: 'left', button: 'bottom', kind: 'click' };

function click(machine: ButtonEventMachine, side: 'L' | 'R', code: number): void {
  assert.deepEqual(machine.push(`[tca8418${side}] gpi press ${code}`), []);
  assert.deepEqual(machine.push(`[tca8418${side}] gpi release ${code}`), []);
}

describe('ButtonEventMachine', () => {
  it('waits for the firmware to say a click was ignored', () => {
    const machine = new ButtonEventMachine();
    click(machine, 'R', 97);
    assert.deepEqual(machine.push('[TTC] ignoring 1 short clicks'), [topRight]);
    assert.deepEqual(machine.push('[TTC] ignoring 1 short clicks'), []);
  });

  it('emits at most the last N clicks in order across both sides', () => {
    const machine = new ButtonEventMachine();
    click(machine, 'R', 99);
    click(machine, 'L', 99);
    click(machine, 'R', 97);
    assert.deepEqual(machine.push('[TTC] ignoring 2 short clicks'), [bottomLeft, topRight]);
    assert.deepEqual(machine.push('[TTC] ignoring 2 short clicks'), []);
  });

  it('does not invent missing clicks or emit any for zero', () => {
    const machine = new ButtonEventMachine();
    click(machine, 'R', 97);
    assert.deepEqual(machine.push('[TTC] ignoring 5 short clicks'), [topRight]);
    click(machine, 'R', 97);
    assert.deepEqual(machine.push('[TTC] ignoring 0 short clicks'), []);
    assert.deepEqual(machine.push('[TTC] ignoring 1 short clicks'), []);
  });

  for (const handled of [
    '[TTC] right top button clicked 1 times',
    '[TTC] left top button clicked 2 times',
    '[thermostat] temp_up right -24->-14',
    '[thermostat] temp_down left -14->-24',
    '[TTC] another firmware result',
  ]) {
    it(`clears pending clicks on ${handled}`, () => {
      const machine = new ButtonEventMachine();
      click(machine, 'R', 97);
      assert.deepEqual(machine.push(handled), []);
      assert.deepEqual(machine.push('[TTC] ignoring 1 short clicks'), []);
    });
  }

  it('collapses repeated presses and ignores releases without a press', () => {
    const machine = new ButtonEventMachine();
    machine.push('[tca8418R] gpi release 97');
    machine.push('[tca8418R] gpi press 97');
    machine.push('[tca8418R] gpi press 97');
    machine.push('[tca8418R] gpi release 97');
    machine.push('[tca8418R] gpi release 97');
    assert.deepEqual(machine.push('[TTC] ignoring 2 short clicks'), [topRight]);
  });

  it('ignores logo clicks, invalid keypad noise and incomplete presses', () => {
    const machine = new ButtonEventMachine();
    click(machine, 'L', 98);
    click(machine, 'R', 105);
    machine.push('[tca8418R] invalid gpi->row 105->255');
    machine.push('[tca8418R] gpi press 127');
    machine.push('[tca8418R] gpi press 97');
    assert.deepEqual(machine.push('[TTC] ignoring 4 short clicks'), []);
  });

  it('leaves firmware long presses without an ignoring result alone', () => {
    const machine = new ButtonEventMachine();
    machine.push('[tca8418R] gpi press 97');
    machine.push('[buttons] long press top: 500ms');
    assert.deepEqual(machine.push('[tca8418R] gpi release 97'), []);
    assert.deepEqual(machine.push('[buttons] top button held for 500ms'), []);
  });
});
