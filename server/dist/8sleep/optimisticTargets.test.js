import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { setOptimisticTarget, getFreshOptimisticTarget, confirmTarget, clearAll, } from './optimisticTargets.js';
describe('optimisticTargets', () => {
    beforeEach(() => clearAll());
    it('returns a fresh value and null when nothing set', () => {
        assert.equal(getFreshOptimisticTarget('left'), null);
        setOptimisticTarget('left', 83);
        assert.equal(getFreshOptimisticTarget('left'), 83);
        assert.equal(getFreshOptimisticTarget('right'), null);
    });
    it('clears once the poller confirms the same value', () => {
        setOptimisticTarget('right', 80);
        confirmTarget('right', 80);
        assert.equal(getFreshOptimisticTarget('right'), null);
    });
    it('does NOT clear on a non-matching polled value (stale poll must not win)', () => {
        setOptimisticTarget('right', 83);
        confirmTarget('right', 81); // stale in-flight snapshot
        assert.equal(getFreshOptimisticTarget('right'), 83);
    });
    it('expires after the TTL so polled truth eventually wins', () => {
        const realNow = Date.now;
        try {
            const base = 4_100_000_000_000;
            Date.now = () => base;
            setOptimisticTarget('left', 90);
            Date.now = () => base + 9_000;
            assert.equal(getFreshOptimisticTarget('left'), 90);
            Date.now = () => base + 11_000;
            assert.equal(getFreshOptimisticTarget('left'), null);
        }
        finally {
            Date.now = realNow;
        }
    });
    it('latest set wins for a side', () => {
        setOptimisticTarget('left', 81);
        setOptimisticTarget('left', 82);
        assert.equal(getFreshOptimisticTarget('left'), 82);
    });
});
//# sourceMappingURL=optimisticTargets.test.js.map