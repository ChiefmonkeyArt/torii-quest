import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCORE_PUBLISH_ENABLED } from '../src/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = readFileSync(join(ROOT, 'src/main.js'), 'utf8');
const RUNTIME = readFileSync(join(ROOT, 'src/arenaRuntime.js'), 'utf8');

describe('development score-publish kill switch', () => {
  it('ships disabled', () => {
    expect(SCORE_PUBLISH_ENABLED).toBe(false);
  });

  it('guards automatic and manual score publishing before any signer call', () => {
    expect(MAIN).toMatch(/async function _publishLatestScore\(\) \{\s*if \(!SCORE_PUBLISH_ENABLED\) return;/);
    expect(MAIN).toMatch(/async function _publishMyScore\(\) \{\s*if \(!SCORE_PUBLISH_ENABLED\) return;/);
    expect(RUNTIME).toMatch(/canPublish: \(\) => SCORE_PUBLISH_ENABLED/);
  });
});
