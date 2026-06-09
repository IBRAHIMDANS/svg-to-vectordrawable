import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convert } from '../src/index.js';

// Golden snapshots: lock the exact converted output for a curated corpus, so any future change
// that alters output is surfaced for review. Run `vitest -u` to update intentionally.
const dir = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures');
const files = readdirSync(dir)
    .filter((f) => f.endsWith('.svg'))
    .sort();

describe('golden snapshots (optimize:false, deterministic)', () => {
    for (const file of files) {
        it(file, () => {
            const { xml, warnings } = convert(readFileSync(join(dir, file), 'utf8'), { optimize: false });
            expect({ xml, warnings: warnings.map((w) => w.code) }).toMatchSnapshot();
        });
    }
});
