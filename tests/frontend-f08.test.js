// tests/frontend-f08.test.js — regression lock for the frontend-audit F08
// peer-avatar ownership fix: a peer clone shares its template's geometry and
// material, so disposing a departed peer must NOT dispose those shared assets
// (that would invalidate the template cache and sibling peers, provoking
// re-uploads). It must instead release only the per-instance deep-cloned gun
// and stop the per-instance mixer.
//
// The renderer-side proof (bounded GPU memory across repeated swaps) is
// exercised in a real browser harness, not here — arenaRuntime.js imports THREE
// and is not node-pure, so this locks the ownership contract at source level.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'arenaRuntime.js'),
  'utf8',
);

describe('F08 — peer-avatar dispose ownership contract', () => {
  it('stops the per-instance mixer and disposes only private (gun) assets', () => {
    // The dispose must uncache the per-instance animation roots…
    expect(SRC).toContain('mixer.stopAllAction()');
    // …and release only the deep-cloned, privately-owned gun meshes.
    expect(SRC).toContain('_privateMeshes');
    expect(SRC).toContain('const _privateMeshes = [];');
  });

  it('no longer traverses the model to dispose shared geometry/material', () => {
    // The old behaviour (`model.traverse` disposing every geometry/material) is
    // gone. The model's geometry/material are shared with _mpTemplateCache and
    // still referenced by sibling peers, so they are deliberately left untouched.
    const disposeFn = SRC.slice(SRC.indexOf('obj.dispose = () => {'));
    expect(disposeFn).not.toContain('model.traverse');
    // The ownership / retain-shared contract is documented in the source.
    expect(SRC).toContain('_mpTemplateCache owns those');
  });

  it('guards the async gun attach against a peer that already left', () => {
    // If the peer is disposed before the gun template resolves, the attach is
    // skipped so no detached gun subtree (or its private geometry) is orphaned.
    expect(SRC).toContain('if (_disposed) return;');
    expect(SRC).toContain('_privateMeshes.push(o)');
  });
});