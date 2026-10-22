// ADR-0146: Gate spec CC0, conformance kit 0BSD, Quest GPL-3.0. Keeps the
// notices in place so a copied kit always carries its permissive licence.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const KIT_CODE = [
  'conformance/gateway-v1/gate-v1.mjs',
  'conformance/gateway-v1/check.mjs',
  'conformance/gateway-v1/reference-world/world.mjs',
  'conformance/gateway-v1/reference-world/index.html',
  'tools/gen-gate-v1-fixtures.mjs',
];
const head = (p) => read(p).split('\n').slice(0, 3).join('\n');

describe('Gate licensing (ADR-0146)', () => {
  it('kit code carries an 0BSD SPDX header', () => {
    for (const f of KIT_CODE) expect(head(f), f).toMatch(/SPDX-License-Identifier: 0BSD/);
  });
  it('the spec and the kit README are CC0', () => {
    for (const f of ['GATEWAY_PROTOCOL.md', 'conformance/gateway-v1/README.md']) expect(head(f), f).toMatch(/SPDX-License-Identifier: CC0-1\.0/);
    expect(read('GATEWAY_PROTOCOL.md')).toMatch(/## Licence\n\nThis specification is dedicated to the public domain under \[CC0 1\.0 Universal\]/);
  });
  it('licence texts are present and official', () => {
    expect(read('LICENSES/0BSD.txt')).toMatch(/^Copyright \(C\) 2026 Chiefmonkey/);
    expect(read('LICENSES/0BSD.txt')).toMatch(/Permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee is hereby granted\./);
    expect(read('LICENSES/CC0-1.0.txt')).toMatch(/CC0 1\.0 Universal/);
    expect(read('LICENSES/CC0-1.0.txt')).toMatch(/Statement of Purpose/);
  });
  it('a copied kit folder carries its own LICENSE', () => {
    const l = read('conformance/gateway-v1/LICENSE');
    expect(l).toMatch(/0BSD/);
    expect(l).toMatch(/CC0 1\.0/);
    expect(l).toMatch(/Permission to use, copy, modify/);
  });
  it('Quest itself stays GPL-3.0 and the README lists the exceptions', () => {
    expect(read('LICENSE')).toMatch(/GNU GENERAL PUBLIC LICENSE\s+Version 3/);
    const r = read('README.md');
    expect(r).toMatch(/\[GNU General Public License v3\.0\]\(LICENSE\)/);
    expect(r).toMatch(/GATEWAY_PROTOCOL\.md.*CC0 1\.0/);
    expect(r).toMatch(/conformance\/gateway-v1\/.*0BSD/);
  });
  it('no GPL notice crept into the kit', () => {
    for (const f of KIT_CODE) expect(read(f), f).not.toMatch(/GNU General Public License|GPL-3/);
    expect(existsSync('conformance/gateway-v1/COPYING')).toBe(false);
  });
});
