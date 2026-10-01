import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { conversionName, describeDays, WEEK_DAYS } from './rhythmDays.js';
const days = (...names) => names;
describe('describeDays', () => {
    it('reads runs, pairs and single days', () => {
        assert.equal(describeDays(days('sunday', 'monday', 'tuesday', 'wednesday', 'thursday')), 'Sun to Thu');
        assert.equal(describeDays(days('friday', 'saturday')), 'Fri and Sat');
        assert.equal(describeDays(days('tuesday')), 'Tuesday');
        assert.equal(describeDays(days('monday', 'wednesday', 'friday')), 'Mon, Wed and Fri');
        assert.equal(describeDays([]), '');
    });
    it('joins a short run across the weekend and names the missing day of six', () => {
        assert.equal(describeDays(days('friday', 'saturday', 'sunday')), 'Fri to Sun');
        assert.equal(describeDays(days('saturday', 'sunday')), 'Sat and Sun');
        assert.equal(describeDays(days('friday', 'saturday', 'sunday', 'monday')), 'Sun, Mon, Fri and Sat');
        assert.equal(describeDays(days('saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday')), 'Every day but Fri');
        assert.equal(describeDays(WEEK_DAYS), 'Every day');
    });
    it('does not depend on the order the days are given in', () => {
        assert.equal(describeDays(days('thursday', 'sunday', 'tuesday', 'monday', 'wednesday')), 'Sun to Thu');
    });
});
describe('conversionName', () => {
    it('uses Every night and Weeknights, and day wording otherwise', () => {
        assert.equal(conversionName(WEEK_DAYS), 'Every night');
        assert.equal(conversionName(days('sunday', 'monday', 'tuesday', 'wednesday', 'thursday')), 'Weeknights');
        assert.equal(conversionName(days('monday', 'tuesday', 'wednesday', 'thursday', 'friday')), 'Mon to Fri');
        assert.equal(conversionName(days('friday', 'saturday')), 'Fri and Sat');
        assert.equal(conversionName(days('saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday')), 'Every night but Fri');
    });
    it('drops the final and from a list that would run past 24 characters', () => {
        assert.equal(conversionName(days('sunday', 'monday', 'wednesday', 'friday', 'saturday')), 'Sun, Mon, Wed, Fri, Sat');
        assert.equal(describeDays(days('sunday', 'monday', 'wednesday', 'friday', 'saturday')), 'Sun, Mon, Wed, Fri and Sat');
    });
    it('gives every set of days its own name of at most 24 characters', () => {
        const names = new Set();
        for (let mask = 1; mask < 128; mask++) {
            const name = conversionName(WEEK_DAYS.filter((_, index) => mask & (1 << index)));
            assert.ok(name.length >= 1 && name.length <= 24, name);
            names.add(name);
        }
        assert.equal(names.size, 127);
    });
});
//# sourceMappingURL=rhythmDays.test.js.map