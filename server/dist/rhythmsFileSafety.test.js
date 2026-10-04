import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { it } from 'node:test';
const scripts = new URL('../../scripts/', import.meta.url);
it('no script touches the Rhythms data file by name', () => {
    // The README screenshot script only drives a browser on the demo build.
    const files = readdirSync(scripts, { recursive: true }).map(String)
        .filter(name => /\.(sh|py|mjs)$/.test(name) && name !== 'readme-screenshots.mjs');
    for (const expected of ['update.sh', 'rollback_pod.sh', 'switch-to-upstream.sh', 'prepare-upstream.py']) {
        assert.ok(files.includes(expected), `missing ${expected}`);
    }
    for (const name of files) {
        assert.doesNotMatch(readFileSync(new URL(name, scripts), 'utf8'), /rhythms/i, name);
    }
});
//# sourceMappingURL=rhythmsFileSafety.test.js.map