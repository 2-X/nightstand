import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isArgWithinBounds } from './executeHelpers.js';
describe('isArgWithinBounds', () => {
    it('allows a command with no declared bounds through unchecked', () => {
        assert.equal(isArgWithinBounds('PRIME', 'anything'), true);
    });
    it('accepts a temperature level within -100..100', () => {
        assert.equal(isArgWithinBounds('TEMP_LEVEL_LEFT', '0'), true);
        assert.equal(isArgWithinBounds('TEMP_LEVEL_RIGHT', '-100'), true);
        assert.equal(isArgWithinBounds('TEMP_LEVEL_RIGHT', '100'), true);
    });
    it('rejects a temperature level outside -100..100', () => {
        assert.equal(isArgWithinBounds('TEMP_LEVEL_LEFT', '101'), false);
        assert.equal(isArgWithinBounds('TEMP_LEVEL_LEFT', '-101'), false);
    });
    it('rejects a non-numeric arg for a bounded command', () => {
        assert.equal(isArgWithinBounds('TEMP_LEVEL_LEFT', 'not-a-number'), false);
    });
    it('accepts a duration within 0..43200 seconds', () => {
        assert.equal(isArgWithinBounds('LEFT_TEMP_DURATION', '43200'), true);
        assert.equal(isArgWithinBounds('RIGHT_TEMP_DURATION', '0'), true);
    });
    it('rejects a duration above the 12-hour cap', () => {
        assert.equal(isArgWithinBounds('LEFT_TEMP_DURATION', '43201'), false);
    });
});
//# sourceMappingURL=executeHelpers.test.js.map