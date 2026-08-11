import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../src/arena-foliage.js', import.meta.url), 'utf8');

describe('grass render budget', () => {
  it('uses four segments and 75k target blades', () => {
    expect(source).toMatch(/const BLADE_SEGS\s*=\s*4;/);
    expect(source).toMatch(/const TARGET_BLADES\s*=\s*75000;/);
  });
});
