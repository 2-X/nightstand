import { it } from 'node:test';
import { buildCurve } from './smartCurve.js';
import { assertCurve, curveInput, fuzzCase, FUZZ_RUNS, FUZZ_SEED, random } from '../testing/smartFuzz.js';
it(`fuzzes command curves (${FUZZ_RUNS} runs, seed ${FUZZ_SEED})`, () => {
    const next = random();
    for (let run = 0; run < FUZZ_RUNS; run++) {
        const input = curveInput(next);
        fuzzCase(input, run, () => assertCurve(buildCurve(input), input));
    }
});
//# sourceMappingURL=smartCurve.fuzz.test.js.map