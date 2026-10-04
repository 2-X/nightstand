import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-firmware-dismiss-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';
const { FirmwareAlarmDismiss, parseAlarmDismiss } = await import('./firmwareAlarmDismiss.js');
const { activeAlarms, forgetActiveAlarm, hasSnooze, setSnooze } = await import('../jobs/activeAlarms.js');
const { default: memoryDB } = await import('../db/memoryDB.js');
const { default: logger } = await import('../logger.js');
const alarm = { vibrationIntensity: 40, duration: 120, vibrationPattern: 'double' };
beforeEach(async () => {
    for (const side of ['left', 'right']) {
        forgetActiveAlarm(side);
        memoryDB.data[side].isAlarmVibrating = false;
    }
    await memoryDB.write();
});
after(() => {
    forgetActiveAlarm('left');
    forgetActiveAlarm('right');
    rmSync(folder, { recursive: true, force: true });
});
async function ring(side) {
    activeAlarms.set(side, { ...alarm });
    memoryDB.data[side].isAlarmVibrating = true;
    await memoryDB.write();
}
test('parses per-side timestamps and ignores unknown channels', () => {
    assert.deepEqual(parseAlarmDismiss('{"l":1728000000,"r":0,"s":12,"unknown":13}'), { left: 1728000000, right: 0 });
});
for (const raw of [undefined, '', 'broken', 'null', 'true', '1', '[]', '"text"', '{}']) {
    test(`ignores absent or malformed dismiss data ${String(raw)}`, () => {
        assert.deepEqual(parseAlarmDismiss(raw), {});
    });
}
for (const value of ['"100"', 'null', 'true', '-1', '0.5', '1e309', '9007199254740992', '{}', '[]']) {
    test(`ignores an invalid timestamp ${value} while keeping the other side`, () => {
        assert.deepEqual(parseAlarmDismiss(`{"l":${value},"r":100}`), { right: 100 });
    });
}
test('the first valid timestamp on each side is a baseline even with an alarm running', async () => {
    const observer = new FirmwareAlarmDismiss();
    await ring('left');
    await ring('right');
    await observer.observe(undefined);
    await observer.observe('broken');
    await observer.observe('{"l":100}');
    await observer.observe('{"l":100,"r":200}');
    assert.equal(activeAlarms.size, 2);
    assert.equal(memoryDB.data.left.isAlarmVibrating, true);
    assert.equal(memoryDB.data.right.isAlarmVibrating, true);
});
for (const side of ['left', 'right']) {
    test(`an increase clears only the ${side} alarm and snooze, once`, async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const info = t.mock.method(logger, 'info');
        const observer = new FirmwareAlarmDismiss();
        await observer.observe('{"l":100,"r":100}');
        await ring('left');
        await ring('right');
        await observer.observe('{"l":100,"r":100}');
        let snoozeRings = 0;
        setSnooze('left', 1000, () => { snoozeRings += 1; });
        setSnooze('right', 1000, () => { snoozeRings += 1; });
        const next = side === 'left' ? '{"l":101,"r":100}' : '{"l":100,"r":101}';
        await observer.observe(next);
        await observer.observe(next);
        const other = side === 'left' ? 'right' : 'left';
        assert.equal(activeAlarms.has(side), false);
        assert.equal(memoryDB.data[side].isAlarmVibrating, false);
        assert.equal(hasSnooze(side), false);
        assert.equal(activeAlarms.has(other), true);
        assert.equal(memoryDB.data[other].isAlarmVibrating, true);
        assert.equal(hasSnooze(other), true);
        assert.equal(info.mock.callCount(), 1);
        t.mock.timers.tick(1000);
        assert.equal(snoozeRings, 1);
    });
}
test('unchanged, absent and malformed reads leave a ringing alarm alone', async () => {
    const observer = new FirmwareAlarmDismiss();
    await observer.observe('{"l":100,"r":0}');
    await ring('left');
    for (const raw of ['{"l":100,"r":0}', undefined, 'broken', '{"l":"101"}', '{"r":0}']) {
        await observer.observe(raw);
        assert.equal(activeAlarms.has('left'), true);
        assert.equal(memoryDB.data.left.isAlarmVibrating, true);
    }
    await observer.observe('{"l":101}');
    assert.equal(activeAlarms.has('left'), false);
});
test('a counter reset and restoration do not dismiss an alarm', async () => {
    const observer = new FirmwareAlarmDismiss();
    await ring('left');
    await observer.observe('{"l":100}');
    await observer.observe('{"l":0}');
    assert.equal(activeAlarms.has('left'), true);
    await observer.observe('{"l":1}');
    assert.equal(activeAlarms.has('left'), true);
    await observer.observe('{"l":100}');
    assert.equal(activeAlarms.has('left'), true);
    await observer.observe('{"l":101}');
    assert.equal(activeAlarms.has('left'), false);
});
test('a replacement alarm uses its first post-start value as its own baseline', async () => {
    const observer = new FirmwareAlarmDismiss();
    await ring('left');
    await observer.observe('{"l":100}');
    await ring('left');
    const replacement = activeAlarms.get('left');
    await observer.observe('{"l":101}');
    assert.equal(activeAlarms.get('left'), replacement);
    assert.equal(memoryDB.data.left.isAlarmVibrating, true);
    await observer.observe('{"l":102}');
    assert.equal(activeAlarms.has('left'), false);
});
test('a value seen without an active alarm is not the next alarm baseline', async () => {
    const observer = new FirmwareAlarmDismiss();
    await observer.observe('{"l":100}');
    await ring('left');
    await observer.observe('{"l":101}');
    assert.equal(activeAlarms.has('left'), true);
    await observer.observe('{"l":102}');
    assert.equal(activeAlarms.has('left'), false);
});
test('a replacement alarm does not inherit the previous alarm high-water mark', async () => {
    const observer = new FirmwareAlarmDismiss();
    await ring('left');
    await observer.observe('{"l":100}');
    await ring('left');
    const replacement = activeAlarms.get('left');
    await observer.observe('{"l":0}');
    assert.equal(activeAlarms.get('left'), replacement);
    await observer.observe('{"l":1}');
    assert.equal(activeAlarms.has('left'), false);
});
for (const side of ['left', 'right']) {
    test(`reset preserves the ${side} alarm high-water mark`, async () => {
        const observer = new FirmwareAlarmDismiss();
        const channel = side === 'left' ? 'l' : 'r';
        await ring(side);
        const active = activeAlarms.get(side);
        await observer.observe(`{"${channel}":100}`);
        observer.reset();
        for (const value of [0, 1, 100]) {
            await observer.observe(`{"${channel}":${value}}`);
            assert.equal(activeAlarms.get(side), active);
            assert.equal(memoryDB.data[side].isAlarmVibrating, true);
        }
        await observer.observe(`{"${channel}":101}`);
        assert.equal(activeAlarms.has(side), false);
        assert.equal(memoryDB.data[side].isAlarmVibrating, false);
    });
}
test('the other side and shared channel cannot dismiss this side', async () => {
    const observer = new FirmwareAlarmDismiss();
    await observer.observe('{"l":100,"r":100,"s":100}');
    await ring('left');
    await observer.observe('{"l":100,"r":101,"s":101}');
    assert.equal(activeAlarms.has('left'), true);
    assert.equal(memoryDB.data.left.isAlarmVibrating, true);
});
test('a dismissal without an active alarm neither changes state nor cancels a snooze, and is not replayed', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const info = t.mock.method(logger, 'info');
    const observer = new FirmwareAlarmDismiss();
    await observer.observe('{"l":100}');
    memoryDB.data.left.isAlarmVibrating = true;
    await memoryDB.write();
    setSnooze('left', 1000, () => { });
    await observer.observe('{"l":101}');
    assert.equal(memoryDB.data.left.isAlarmVibrating, true);
    assert.equal(hasSnooze('left'), true);
    assert.equal(info.mock.callCount(), 0);
    await ring('left');
    await observer.observe('{"l":101}');
    assert.equal(activeAlarms.has('left'), true);
});
test('a dismissal does not clear a replacement alarm started during the memory read', async (t) => {
    const observer = new FirmwareAlarmDismiss();
    await observer.observe('{"l":100}');
    await ring('left');
    await observer.observe('{"l":100}');
    const read = memoryDB.read.bind(memoryDB);
    const replacement = { ...alarm };
    t.mock.method(memoryDB, 'read', async () => {
        await read();
        activeAlarms.set('left', replacement);
    });
    await observer.observe('{"l":101}');
    assert.equal(activeAlarms.get('left'), replacement);
    assert.equal(memoryDB.data.left.isAlarmVibrating, true);
});
test('a two-side dismissal cannot clear an alarm that starts on the other side during the read', async (t) => {
    const observer = new FirmwareAlarmDismiss();
    await observer.observe('{"l":100,"r":100}');
    await ring('left');
    await observer.observe('{"l":100,"r":100}');
    const read = memoryDB.read.bind(memoryDB);
    let started = false;
    t.mock.method(memoryDB, 'read', async () => {
        await read();
        if (!started) {
            started = true;
            activeAlarms.set('right', { ...alarm });
            memoryDB.data.right.isAlarmVibrating = true;
        }
    });
    await observer.observe('{"l":101,"r":101}');
    assert.equal(activeAlarms.has('left'), false);
    assert.equal(activeAlarms.has('right'), true);
    assert.equal(memoryDB.data.right.isAlarmVibrating, true);
});
//# sourceMappingURL=firmwareAlarmDismiss.test.js.map