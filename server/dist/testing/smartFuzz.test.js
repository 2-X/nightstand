import assert from 'node:assert/strict';
import { it } from 'node:test';
import { curveInput, random, ZONES } from './smartFuzz.js';
it('samples every option and off mode in every zone without coupling cool-start to off', () => {
    const next = random(20261006);
    const seen = new Set();
    for (let run = 0; run < 4096; run++) {
        const input = curveInput(next);
        const off = Math.sign(input.powerOff.getTime() - input.wake.getTime());
        const cool = Math.sign(input.coolStart.getTime() - input.bedtime.getTime());
        seen.add(`${input.timeZone}/${off}/cool/${cool}`);
        for (const key of ['intensity', 'warmStart', 'warmUp', 'upEarly', 'offWhenUp']) {
            seen.add(`${input.timeZone}/${off}/${key}/${input.smart[key] ?? false}`);
        }
    }
    for (const zone of ZONES)
        for (const off of [-1, 0, 1]) {
            for (const cool of [-1, 0, 1])
                assert.ok(seen.has(`${zone}/${off}/cool/${cool}`), `${zone}/${off}/cool/${cool}`);
            for (const key of ['intensity', 'warmStart', 'warmUp', 'upEarly', 'offWhenUp']) {
                for (const value of key === 'intensity' ? ['gentle', 'standard'] : [false, true]) {
                    assert.ok(seen.has(`${zone}/${off}/${key}/${value}`), `${zone}/${off}/${key}/${value}`);
                }
            }
        }
});
//# sourceMappingURL=smartFuzz.test.js.map