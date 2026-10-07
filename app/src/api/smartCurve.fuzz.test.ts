import { it } from 'vitest';
import { buildCurve } from './smartCurve';
import { assertCurve, curveInput, fuzzCase, FUZZ_RUNS, FUZZ_SEED, random } from '../../../server/src/testing/smartFuzz';

it(`fuzzes the app curve import (${FUZZ_RUNS} runs, seed ${FUZZ_SEED})`, () => {
  const next = random();
  for (let run = 0; run < FUZZ_RUNS; run++) {
    const input = curveInput(next);
    fuzzCase(input, run, () => assertCurve(buildCurve(input), input));
  }
});
