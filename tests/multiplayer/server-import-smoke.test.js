// tests/multiplayer/server-import-smoke.test.js — advisor-mandated verification:
// the server bot path must import + run with NO THREE / Rapier / scene leaking.
// The deployed server has no WebGL and no Rapier WASM, so any transitive import
// of 'three', '@dimforge/rapier3d', or a scene/DOM module would crash it at boot.
//
// (1) Static: walk the whole import graph reachable from server/bots/arenaBotSim.js
//     (the module arena-ws.js pulls in) and assert no forbidden specifier appears.
// (2) Functional: actually import and drive the sim headlessly (spawn/tick/
//     snapshot/resolvePlayerShot/applyBotDamage) — if any dep pulled THREE it
//     would throw on import here.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createArenaBotSim } from '../../server/bots/arenaBotSim.js';
import { BOT_COUNT } from '../../src/config.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(HERE, '../../server/bots/arenaBotSim.js');

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

describe('server bot sim runs headlessly end-to-end', () => {
  it('spawns, ticks, snapshots, resolves a shot and applies damage without importing THREE', () => {
    const shots = [];
    const sim = createArenaBotSim({ onBotShot: (o, d) => shots.push({ o, d }) });
    sim.spawn(BOT_COUNT);
    const snap = sim.snapshot();
    expect(snap).toHaveLength(BOT_COUNT);

    const player = { x: snap[0].x, y: 1.6, z: snap[0].z + 2, outsideFence: false, flyEnabled: false };
    expect(() => {
      for (let i = 0; i < 30; i++) sim.tick(1 / 20, [player]);
    }).not.toThrow();

    const b = sim.snapshot()[0];
    const res = sim.resolvePlayerShot([b.x + 3, 0, b.z], [-1, 0, 0]);
    // A shot straight along the bot's row either hits it or cleanly misses —
    // never throws (the point is headless execution, not the specific outcome).
    expect(res === null || typeof res.botId === 'number').toBe(true);

    const dmg = sim.applyBotDamage(snap[0].id, 1, { x: 0, z: 0 });
    expect(dmg.hit).toBe(true);
  });
});
