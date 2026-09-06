// tests/v0.2.780-regression.test.js — upload rig verdict surfaced in the
// Character tab UI (follow-up on v0.2.779's validator-first upload).
//
// v0.2.779 made the .glb upload validator-first (inspectGlb + assessRig before
// any network call) but surfaced the verdict only as a one-shot toast. This
// ship wires the assessed rig into the panel: main.js stores a compact summary
// on _characterForgeState.rig during upload, passes it to the renderer, and the
// panel renders a "Rig OK" / "Rig warning" status line both during creation and
// in the found summary. Source-locking here keeps main.js's wiring honest
// without importing the whole entry module.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const SRC = {
  main: read('src/main.js'),
  panel: read('src/engine/settings/characterForgePanel.js'),
  index: read('index.html'),
};

function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/gm, '$1');
}

describe('v0.2.780 — upload rig verdict in the Character tab', () => {
  it('main.js stores an assessed rig summary on the forge state', () => {
    const src = stripComments(SRC.main);
    expect(src).toContain('rig: null,');            // state field
    expect(src).toMatch(/function _summarizeRig\(/);
    expect(src).toContain('_characterForgeState.rig = _summarizeRig(rig);');
  });

  it('main.js passes the rig summary into the panel renderer', () => {
    expect(SRC.main).toContain('rig: _characterForgeState.rig,');
  });

  it('characterForgePanel renders the rig verdict via a cf-rig status line', () => {
    const src = stripComments(SRC.panel);
    expect(src).toMatch(/function _rigVerdict\(/);
    expect(src).toContain('cf-rig-ok');
    expect(src).toContain('cf-rig-warn');
    expect(src).toContain('_foundView(st.character, rig)');
  });

  it('index.html carries styles for the rig verdict line', () => {
    const css = SRC.index;
    expect(css).toContain('.cf-rig {');
    expect(css).toContain('.cf-rig-ok .cf-rig-label');
    expect(css).toContain('.cf-rig-warn .cf-rig-label');
  });
});