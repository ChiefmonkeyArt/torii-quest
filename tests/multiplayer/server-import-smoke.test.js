// tests/multiplayer/server-import-smoke.test.js — the server combat path must
// import + run with NO THREE / Rapier / scene leaking. The deployed server has no
// WebGL and no Rapier WASM, so any transitive import of 'three',
// '@dimforge/rapier3d', or a scene/DOM module would crash it at boot.
//
// Game Zone v2 (ADR-0130): the entry is server/gamezone/gameZoneServer.js, which
// runs the SAME src/gamezone/core sim the browser runs in single-player.
// (1) Static: walk the whole import graph and assert no forbidden specifier.
// (2) Functional: import and drive the server headlessly (auth/move/fire/tick).
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameZoneServer } from '../../server/gamezone/gameZoneServer.js';
import { BOT_COUNT } from '../../src/config.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(HERE, '../../server/gamezone/gameZoneServer.js');

const FORBIDDEN = [
  'three',
  '@dimforge/rapier3d',
  'rapier',
  './scene',
  '/scene.js',
];

// Collect every relative-import file transitively reachable from `entry`.
function collectGraph(entry) {
  const seen = new Set();
  const stack = [entry];
  const specifiers = []; // { from, spec }
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    const re = /import\s+[^'"]*from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const spec = m[1] || m[2];
      specifiers.push({ from: file, spec });
      if (spec.startsWith('.')) {
        let target = resolve(dirname(file), spec);
        if (!target.endsWith('.js')) target += '.js';
        stack.push(target);
      }
    }
  }
  return { files: seen, specifiers };
}

describe('server bot path is headless (no THREE/Rapier/scene)', () => {
  const graph = collectGraph(ENTRY);

  it('reaches a non-trivial module graph', () => {
    expect(graph.files.size).toBeGreaterThan(3);
  });

  it('imports no forbidden specifier anywhere in the graph', () => {
    const offenders = graph.specifiers.filter(({ spec }) =>
      FORBIDDEN.some((bad) => spec === bad || spec.includes(bad)),
    );
    expect(offenders).toEqual([]);
  });
});

describe('server game zone runs headlessly end-to-end', () => {
  it('seats a player, ticks, snapshots and resolves a shot without importing THREE', () => {
    const sent = [];
    const sessions = new Map();
    const gz = createGameZoneServer({
      sessions,
      isKamiActive: () => false,
      sendTo: (sess, msg) => sent.push({ to: sess.id, msg }),
      broadcastToOthers: () => {},
      sendToSpectators: () => {},
      spectatorCount: () => 0,
      encode: (m) => JSON.stringify(m),
      seed: 3,
    });
    const sess = { id: 'p1', authed: true, pos: [0, 1.7, 0], rot: [0, 0], ws: { send: (w) => sent.push({ to: 'p1', msg: JSON.parse(w) }) } };
    sessions.set(sess.id, sess);
    gz.onAuth(sess);
    expect(() => { for (let i = 0; i < 30; i++) gz.tick(); }).not.toThrow();
    const snaps = sent.filter((s) => s.msg.t === 'GZ_SNAP');
    expect(snaps.length).toBeGreaterThan(0);
    expect(snaps.at(-1).msg.b).toHaveLength(BOT_COUNT);
    gz.onFire(sess, { seq: 1, origin: [0, 1.7, 0], dir: [1, 0, 0], rt: gz.sim.tick, claim: null });
    gz.tick();
    const results = sent.filter((s) => s.msg.t === 'GZ_EVENT').flatMap((s) => s.msg.ev).filter((e) => e.type === 'result');
    expect(results.some((r) => r.seq === 1)).toBe(true);
    gz.stop();
  });
});
