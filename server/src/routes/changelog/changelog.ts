import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../../logger.js';
import { parseChangelog } from './changelogParser.js';
import type { ChangelogResponse } from './changelogSchema.js';

const router = express.Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHANGELOG_PATH = path.resolve(__dirname, '../../../../CHANGELOG.md');

// CHANGELOG.md only changes when the pod installs a new build (the updater
// replaces the whole tree), so the parsed result is cached for the life of
// the process instead of re-parsing on every request.
let cached: ChangelogResponse | null = null;

router.get('/', async (_req, res) => {
  try {
    if (!cached) {
      const markdown = await fs.promises.readFile(CHANGELOG_PATH, 'utf8');
      cached = { entries: parseChangelog(markdown) };
    }
    res.json(cached);
  } catch (error) {
    logger.error('Failed to read/parse CHANGELOG.md', error);
    res.status(500).json({ message: 'Unable to read changelog' });
  }
});

export default router;
