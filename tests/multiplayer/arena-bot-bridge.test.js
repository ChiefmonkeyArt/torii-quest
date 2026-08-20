// tests/multiplayer/arena-bot-bridge.test.js — v0.2.610 regression guard for the
// operator-reported "bots not honing/aware (MP)": the server bot sim ran with
// isBridgeWalkable=()=>false and NO bridgeWaypoints, so a bot whose target was
// on the other arena island steered into the coastline clamp and BEACHED at the
// water's edge forever (SP routes over Bridge 2 — MP must too).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createArenaBotSim } from '../../server/bots/arenaBotSim.js';
import { isOnBridge2, BRIDGE2_WAYPOINTS } from '../../src/engine/entities/bridge2Walk.js';
import { whichIsland, ISLAND_BL, ISLAND_BR } from '../../src/terrain/tomoeShape.js';
import { BRIDGE2_X, BRIDGE2_Z, BRIDGE2_LEN, BRIDGE2_WIDTH, BOT_COUNT } from '../../src/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER_SIM = readFileSync(join(ROOT, 'server/bots/arenaBotSim.js'), 'utf8');
const CLIENT_BOTS = readFileSync(join(ROOT, 'src/bots.js'), 'utf8');

describe('bridge2Walk shared module', () => {
  it('derives the walkable AABB from config with the 0.3m bot-radius margin', () => {
    expect(isOnBridge2(BRIDGE2_X, BRIDGE2_Z)).toBe(true);
    expect(isOnBridge2(BRIDGE2_X - BRIDGE2_LEN / 2 - 0.29, BRIDGE2_Z)).toBe(true);
    expect(isOnBridge2(BRIDGE2_X - BRIDGE2_LEN / 2 - 0.31, BRIDGE2_Z)).toBe(false);
    expect(isOnBridge2(BRIDGE2_X, BRIDGE2_Z - BRIDGE2_WIDTH / 2 - 0.31)).toBe(false);
    expect(isOnBridge2(20, 20)).toBe(false);
  });

  it('entry waypoints sit on the deck ends, one foot on each island', () => {
    expect(BRIDGE2_WAYPOINTS).toHaveLength(2);
    for (const [x, z] of BRIDGE2_WAYPOINTS) expect(isOnBridge2(x, z)).toBe(true);
    expect(whichIsland(...BRIDGE2_WAYPOINTS[0])).toBe(ISLAND_BL);
    expect(whichIsland(...BRIDGE2_WAYPOINTS[1])).toBe(ISLAND_BR);
  });

  it('is wired into BOTH the server sim and the client wrapper (parity)', () => {
    expect(SERVER_SIM).toMatch(/isBridgeWalkable:\s*isOnBridge2/);
    expect(SERVER_SIM).toMatch(/bridgeWaypoints:\s*BRIDGE2_WAYPOINTS/);
    expect(CLIENT_BOTS).toMatch(/isBridgeWalkable:\s*_isOnBridge2/);
    expect(CLIENT_BOTS).toMatch(/bridgeWaypoints:\s*_BRIDGE2_WAYPOINTS/);
  });
});

describe('server bot cross-island honing (live tick)', () => {
  it('a bot on BL with a player on BR closes distance instead of beaching', () => {
    const sim = createArenaBotSim({});
    sim.spawn(BOT_COUNT);
    // Pick any alive regular bot and teleport it onto BL, far from the bridge.
    const st = sim.bots.find((b) => b.alive && b.kind !== 'boss') || sim.bots[0];
    st.pos.x = -14; st.pos.z = -16;
    expect(whichIsland(st.pos.x, st.pos.z)).toBe(ISLAND_BL);

    // Sole player on BR — every bot's only possible target.
    const player = { id: 'p1', x: 18, y: 3, z: -3, outsideFence: false, flyEnabled: false };
    expect(whichIsland(player.x, player.z)).toBe(ISLAND_BR);

    const d0 = Math.hypot(player.x - st.pos.x, player.z - st.pos.z);
    expect(d0).toBeGreaterThan(30); // sanity: genuinely cross-island start
    let crossedBridge = false;
    for (let i = 0; i < 600; i++) { // 30s at 20Hz
      sim.tick(1 / 20, [player]);
      if (isOnBridge2(st.pos.x, st.pos.z)) crossedBridge = true;
    }
    const d1 = Math.hypot(player.x - st.pos.x, player.z - st.pos.z);

    // Pre-fix the bot beached at the BL waterline ~22m from the player (the
    // coastline clamp stops it at the channel edge). Crossing Bridge 2 puts it
    // on the player's island, closing to the flank ring (< 12m).
    expect(crossedBridge).toBe(true);
    expect(d1).toBeLessThan(12);
  });
});
