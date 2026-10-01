import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const folder = mkdtempSync(path.join(tmpdir(), 'rhythms-store-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';
const file = path.join(folder, 'lowdb', 'rhythmsDB.json');
const fixtureText = (name) => readFileSync(new URL(`../../../fixtures/compat/future/${name}.json`, import.meta.url), 'utf8');
const { createRhythms, loadRhythms, parseRhythms, RhythmsStateError, updateRhythms } = await import('./rhythms.js');
const { dbOf, rhythmOf, sideOf, WORKDAY } = await import('../jobs/rhythms/rhythmsTestData.js');
const sample = () => dbOf(sideOf([rhythmOf('workday', WORKDAY)], { monday: 'workday' }));
beforeEach(() => rmSync(file, { force: true }));
after(() => rmSync(folder, { recursive: true, force: true }));
describe('loadRhythms', () => {
    it('reports absent and never creates the file', async () => {
        assert.deepEqual(await loadRhythms(), { state: 'absent' });
        assert.equal(existsSync(file), false);
    });
    it('reads a future version 1 file with unknown keys stripped and leaves the file alone', async () => {
        const text = fixtureText('rhythmsDB');
        writeFileSync(file, text);
        const load = await loadRhythms();
        assert.equal(load.state, 'ok');
        assert.ok(load.state === 'ok');
        assert.deepEqual(Object.keys(load.db).sort(), ['left', 'legacyFingerprint', 'right', 'version']);
        assert.equal(JSON.stringify(load.db).includes('future'), false);
        assert.equal(load.db.left.week.monday, 'workday');
        assert.equal(readFileSync(file, 'utf8'), text);
    });
    it('reports a newer file version as unsupported', async () => {
        writeFileSync(file, fixtureText('rhythmsDB-v2'));
        assert.deepEqual(await loadRhythms(), { state: 'unsupported', version: 2 });
    });
    it('reports unreadable and malformed files as invalid', async () => {
        writeFileSync(file, '{');
        assert.equal((await loadRhythms()).state, 'invalid');
        writeFileSync(file, '{"version":1}');
        const load = await loadRhythms();
        assert.equal(load.state, 'invalid');
        assert.ok(load.state === 'invalid' && load.error.includes('legacyFingerprint'));
    });
});
describe('parseRhythms', () => {
    it('treats a missing version and version 0 as invalid, not unsupported', () => {
        assert.equal(parseRhythms('{}').state, 'invalid');
        assert.equal(parseRhythms(JSON.stringify({ ...sample(), version: 0 })).state, 'invalid');
        assert.equal(parseRhythms('null').state, 'invalid');
    });
});
describe('createRhythms', () => {
    it('writes the file the first time only', async () => {
        await createRhythms(sample());
        assert.deepEqual(await loadRhythms(), { state: 'ok', db: sample() });
        await assert.rejects(createRhythms(sample()), RhythmsStateError);
    });
    it('refuses data that fails the strict schema', async () => {
        await assert.rejects(createRhythms({ ...sample(), extra: true }));
        assert.equal(existsSync(file), false);
    });
    it('refuses over an unsupported or invalid file and leaves it alone', async () => {
        for (const [text, state] of [[fixtureText('rhythmsDB-v2'), 'unsupported'], ['{', 'invalid']]) {
            writeFileSync(file, text);
            await assert.rejects(createRhythms(sample()), (error) => error instanceof RhythmsStateError && error.state === state);
            assert.equal(readFileSync(file, 'utf8'), text);
        }
    });
});
describe('updateRhythms', () => {
    it('refuses to run unless the file is ok, without writing', async () => {
        await assert.rejects(updateRhythms(() => { }), (error) => error instanceof RhythmsStateError && error.state === 'absent');
        assert.equal(existsSync(file), false);
        for (const [text, state] of [[fixtureText('rhythmsDB-v2'), 'unsupported'], ['{', 'invalid']]) {
            writeFileSync(file, text);
            await assert.rejects(updateRhythms(() => { }), (error) => error instanceof RhythmsStateError && error.state === state);
            assert.equal(readFileSync(file, 'utf8'), text);
        }
    });
    it('applies the change, keeps unknown keys in the file and returns the stripped data', async () => {
        writeFileSync(file, fixtureText('rhythmsDB'));
        const saved = await updateRhythms(draft => { draft.left.week.saturday = 'workday'; });
        assert.equal(saved.left.week.saturday, 'workday');
        assert.equal(JSON.stringify(saved).includes('future'), false);
        const stored = JSON.parse(readFileSync(file, 'utf8'));
        assert.equal(stored.left.week.saturday, 'workday');
        assert.deepEqual(stored.futureTop, { kept: true });
        assert.equal(stored.left.rhythms.workday.futureRhythm.kept, true);
    });
    it('writes nothing when the mutation returns false', async () => {
        writeFileSync(file, fixtureText('rhythmsDB'));
        const before = readFileSync(file, 'utf8');
        await updateRhythms(() => false);
        assert.equal(readFileSync(file, 'utf8'), before);
    });
    it('refuses a change that leaves the data invalid', async () => {
        await createRhythms(sample());
        const before = readFileSync(file, 'utf8');
        await assert.rejects(updateRhythms(draft => { draft.left.week.monday = 'Not An Id'; }), /Refusing to save invalid rhythms/);
        assert.equal(readFileSync(file, 'utf8'), before);
    });
    it('refuses an async change before writing anything', async () => {
        await createRhythms(sample());
        const before = readFileSync(file, 'utf8');
        // The type already refuses this; the check covers callers that get past it.
        const late = async (draft) => { draft.left.week.friday = 'workday'; };
        await assert.rejects(updateRhythms(late), /synchronous/);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(readFileSync(file, 'utf8'), before);
    });
    it('leaves no unhandled rejection behind when a refused async change fails', async () => {
        await createRhythms(sample());
        const unhandled = [];
        const record = (reason) => unhandled.push(reason);
        process.on('unhandledRejection', record);
        try {
            const failing = async () => { throw new Error('late failure'); };
            await assert.rejects(updateRhythms(failing), /synchronous/);
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        finally {
            process.off('unhandledRejection', record);
        }
        assert.deepEqual(unhandled, []);
    });
    it('keeps the previous file when the disk write fails', async () => {
        await createRhythms(sample());
        const before = readFileSync(file, 'utf8');
        const temp = path.join(folder, 'lowdb', '.rhythmsDB.json.tmp');
        mkdirSync(temp);
        try {
            await assert.rejects(updateRhythms(draft => { draft.left.week.friday = 'workday'; }), { code: 'EISDIR' });
        }
        finally {
            rmSync(temp, { recursive: true, force: true });
        }
        assert.equal(readFileSync(file, 'utf8'), before);
        const saved = await updateRhythms(draft => { draft.left.week.friday = 'workday'; });
        assert.equal(saved.left.week.friday, 'workday');
    });
    it('applies concurrent updates one after another', async () => {
        await createRhythms(sample());
        await Promise.all([
            updateRhythms(draft => { draft.left.week.tuesday = 'workday'; }),
            updateRhythms(draft => { draft.left.week.wednesday = 'workday'; }),
        ]);
        const load = await loadRhythms();
        assert.ok(load.state === 'ok');
        assert.equal(load.db.left.week.tuesday, 'workday');
        assert.equal(load.db.left.week.wednesday, 'workday');
    });
});
//# sourceMappingURL=rhythms.test.js.map