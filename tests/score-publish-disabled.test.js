import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCORE_PUBLISH_ENABLED } from '../src/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = readFileSync(join(ROOT, 'src/main.js'), 'utf8');
const RUNTIME = readFileSync(join(ROOT, 'src/arenaRuntime.js'), 'utf8');

// v0.2.611: the kill switch is OFF — score publishing is live. What this suite
// now freezes is the CONSENT shape: the guard structure stays in place (the
// functions still branch on the flag + only run from an explicit click path),
// so a future accidental flag flip is caught here.
describe('score-publish consent gate (v0.2.611: live, click-consented)', () => {
  it('ships enabled (publishing live; every relay write is click-consented)', () => {
    expect(SCORE_PUBLISH_ENABLED).toBe(true);
  });

  it('guards automatic and manual score publishing before any signer call', () => {
    expect(MAIN).toMatch(/async function _publishLatestScore\(\) \{\s*if \(!SCORE_PUBLISH_ENABLED\) return;/);
    expect(MAIN).toMatch(/async function _publishMyScore\(\) \{\s*if \(!SCORE_PUBLISH_ENABLED\) return;/);
    expect(RUNTIME).toMatch(/canPublish: \(\) => SCORE_PUBLISH_ENABLED/);
  });
});
