// Turns the firmware's button log lines into one event per press. No I/O:
// buttonMonitor.ts feeds it the `msg` of each RAW `log` record in file order.
//
// The lines, from a Pod 4 hub with a Pod 5 cover (docs/EIGHT_SLEEP_PROTOCOL.md,
// "Other Pod generations"):
//   [tca8418R] gpi press 97       R or L is the side; 97, 98, 99 are plus, logo, minus
//   [tca8418R] gpi release 97
//   [buttons] top button held for 320ms (abort)   the older host firmware's long press
//   [buttons] middle button held for 160ms         a completed hold without (abort)
//   [buttons] long press top: 500ms                the newer host firmware's long press
//
// A press and its release make one click. Press lines can repeat while a
// button is held and collapse into the first. A hold line for a button that
// is down turns the press into a hold and swallows its release, so a long
// press is never also a click. On the newer host firmware the `held for`
// line arrives after the release and changes nothing, and the firmware acts
// on its own long presses through the tap counters, so the release after a
// `long press` line must not become a click or the press is applied twice.

export type ButtonSide = 'left' | 'right';
export type ButtonName = 'top' | 'middle' | 'bottom';
export type ButtonKind = 'click' | 'hold';

export interface ButtonEvent {
  side: ButtonSide;
  button: ButtonName;
  kind: ButtonKind;
}

// Keypad codes in the cover's physical order, top to bottom. Which of top and
// bottom warms the bed is settled by the side's invertButtons setting, not here.
const CODE_TO_BUTTON: Record<number, ButtonName> = {
  97: 'top',
  98: 'middle',
  99: 'bottom',
};

const PRESS_RE = /\[tca8418([RL])\]\s+gpi\s+(press|release)\s+(\d+)/i;
const HELD_RE = /\[buttons\]\s+(top|middle|bottom)\s+button\s+held\s+for\s+(\d+)ms\s*(\(abort\))?/i;
const LONG_PRESS_RE = /\[buttons\]\s+long\s+press\s+(top|middle|bottom):\s*(\d+)ms/i;

interface Pending {
  // A press was seen and its release has not arrived.
  down: boolean;
  // The release must not become a click: a hold took the press.
  suppressed: boolean;
}

export class ButtonEventMachine {
  private pending = new Map<string, Pending>();

  private static key(side: ButtonSide, button: ButtonName): string {
    return `${side}:${button}`;
  }

  // Feeds one log line and returns the events it completed, usually none or
  // one. Lines that are not about buttons return [].
  public push(message: string): ButtonEvent[] {
    const press = PRESS_RE.exec(message);
    if (press) return this.onPressLine(press);

    const held = HELD_RE.exec(message);
    if (held) return this.onHeldLine(held);

    const longPress = LONG_PRESS_RE.exec(message);
    if (longPress) return this.onLongPressLine(longPress);

    return [];
  }

  private onPressLine(match: RegExpExecArray): ButtonEvent[] {
    const side: ButtonSide = match[1].toUpperCase() === 'L' ? 'left' : 'right';
    const edge = match[2].toLowerCase();
    const button = CODE_TO_BUTTON[Number(match[3])];
    if (!button) return [];

    const key = ButtonEventMachine.key(side, button);

    if (edge === 'press') {
      const existing = this.pending.get(key);
      if (existing?.down) return [];
      this.pending.set(key, { down: true, suppressed: false });
      return [];
    }

    const state = this.pending.get(key);
    this.pending.delete(key);
    if (!state?.down) return [];
    if (state.suppressed) return [];
    return [{ side, button, kind: 'click' }];
  }

  private onHeldLine(match: RegExpExecArray): ButtonEvent[] {
    const button = match[1].toLowerCase() as ButtonName;
    const aborted = Boolean(match[3]);
    // The line names no side: it belongs to the side holding that button.
    const side = this.findDownSide(button);
    if (!side) return [];

    const state = this.pending.get(ButtonEventMachine.key(side, button));
    if (state) state.suppressed = true;
    return aborted ? [] : [{ side, button, kind: 'hold' }];
  }

  // The newer host firmware announces a long press while the button is still
  // down and handles it itself; the release that follows is swallowed.
  private onLongPressLine(match: RegExpExecArray): ButtonEvent[] {
    const button = match[1].toLowerCase() as ButtonName;
    const side = this.findDownSide(button);
    if (!side) return [];
    const state = this.pending.get(ButtonEventMachine.key(side, button));
    if (state) state.suppressed = true;
    return [{ side, button, kind: 'hold' }];
  }

  private findDownSide(button: ButtonName): ButtonSide | null {
    for (const side of ['left', 'right'] as const) {
      const state = this.pending.get(ButtonEventMachine.key(side, button));
      if (state?.down) return side;
    }
    return null;
  }
}
