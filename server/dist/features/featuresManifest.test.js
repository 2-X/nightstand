import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURES_MANIFEST } from './featuresManifest.js';
import { defaultFeatures } from '../db/settingsSchema.js';
const REQUIRED_FIELDS = [
    'id', 'title', 'description', 'category', 'version', 'touchpoints',
    'depends_on', 'reversible', 'tests', 'upstream_offer', 'rationale',
];
const isFeaturesSchemaKey = (flag) => typeof flag === 'string' && flag in defaultFeatures;
// featuresManifest.ts is the catalog releases.json names features from, so a
// typo in either would otherwise only surface at install time.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const releasesManifest = JSON.parse(readFileSync(path.join(repoRoot, 'releases.json'), 'utf8'));
describe('FEATURES_MANIFEST', () => {
    it('has every required field, non-empty where it is a string', () => {
        for (const entry of FEATURES_MANIFEST) {
            for (const field of REQUIRED_FIELDS) {
                const value = entry[field];
                assert.notEqual(value, undefined, `${entry.id}.${field} is missing`);
                if (typeof value === 'string') {
                    assert.notEqual(value.trim(), '', `${entry.id}.${field} is empty`);
                }
            }
        }
    });
    it('has unique ids', () => {
        const ids = FEATURES_MANIFEST.map((entry) => entry.id);
        assert.deepEqual(ids, [...new Set(ids)]);
    });
    it('has every depends_on reference a real entry in the same manifest', () => {
        const ids = new Set(FEATURES_MANIFEST.map((entry) => entry.id));
        for (const entry of FEATURES_MANIFEST) {
            for (const dep of entry.depends_on) {
                assert.ok(ids.has(dep), `${entry.id} depends_on unknown id "${dep}"`);
            }
        }
    });
    // biometrics and base-control document their own external mechanisms in
    // flag as prose (a separate lowdb store, hardware-file presence), not a
    // FeaturesSchema key, so they are exempt from the default-matches-live-
    // default check below by design, not by oversight.
    it('has a default matching the live schema default, for every entry whose flag is a real FeaturesSchema key', () => {
        for (const entry of FEATURES_MANIFEST) {
            if (!isFeaturesSchemaKey(entry.flag))
                continue;
            assert.equal(entry.default, defaultFeatures[entry.flag], `${entry.id}'s manifest default does not match settingsSchema.ts's defaultFeatures.${entry.flag}`);
        }
    });
    // No bundle releases exist yet, so this passes vacuously today. It is the
    // guard that arms the moment the first one lands.
    it('has every feature id named by a bundle release', () => {
        const ids = new Set(FEATURES_MANIFEST.map((entry) => entry.id));
        for (const release of releasesManifest.releases) {
            if (release.kind !== 'bundle')
                continue;
            for (const feature of release.features) {
                assert.ok(ids.has(feature), `releases.json bundle v${release.version} names unknown feature "${feature}"`);
            }
        }
    });
});
//# sourceMappingURL=featuresManifest.test.js.map