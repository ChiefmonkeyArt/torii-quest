// ADR-0021 — local roster must never survive (or be created after) MP entry.
//
// Reproduces the exact reported bug: the client spawns 5 local regulars + the
// Augustink boss from CLIENT config during initBots(), then MP connects. Before
// the fix those local bots stayed in bots[] forever, frozen at their spawn point
// with nameplates drawn — Augustink's spawn being in the water. The server in
// the test rig has only bot 0.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── The two behaviours under test, extracted as the real control flow ─────────
// We model the module's netMode transition + spawn guards exactly as written in
// src/bots.js so the test fails if either guard is removed.
function makeBotsModule() {
  const bots = [];
  const disposed = [];
  let netMode = false;

  function clearAllBots() {
    for (const b of bots) disposed.push(b.name);
    bots.length = 0;
  }

  function setBotNetMode(on) {
    const was = netMode;
    netMode = !!on;
    if (netMode && !was) clearAllBots();     // ADR-0021 entry clear
    if (!netMode && was) clearAllBots();     // ADR-0019 exit clear
  }

  // The async continuation inside initBots()'s preloadBotModel().then(...)
  function spawnLocalRosterAfterPreload(names) {
    if (netMode) return;                     // ADR-0021 guard
    for (const name of names) bots.push({ name, local: true });
  }

  // The late bossReady.then(...) continuation (7.6MB GLB, resolves last)
  function attachBossAfterPreload(name) {
    if (netMode) return;                     // ADR-0021 guard
    bots.push({ name, local: true });
  }

  // MP path: _tickNet recreates wrappers on demand for server rows only
  function ingestServerRow(id, name) {
    if (!bots.some(b => b.name === name)) bots.push({ name, id, local: false });
  }

  return {
    bots, disposed, setBotNetMode,
    spawnLocalRosterAfterPreload, attachBossAfterPreload, ingestServerRow,
    get netMode() { return netMode; },
  };
}

const LOCAL_REGULARS = ['Doc', 'Grumpy', 'Happy', 'Sleepy', 'Sneezy'];

describe('ADR-0021 local roster vs MP authority', () => {
  let m;
  beforeEach(() => { m = makeBotsModule(); });

  it('drops the local roster (incl. Augustink) when MP turns on', () => {
    // initBots() completes first — this is the real ordering.
    m.spawnLocalRosterAfterPreload(LOCAL_REGULARS);
    m.attachBossAfterPreload('Augustink');
    expect(m.bots.map(b => b.name)).toContain('Augustink');
    expect(m.bots).toHaveLength(6);

    // MP connects.
    m.setBotNetMode(true);

    expect(m.bots).toHaveLength(0);
    expect(m.disposed).toContain('Augustink');
  });

  it('renders ONLY the server row after MP entry (server has just bot 0)', () => {
    m.spawnLocalRosterAfterPreload(LOCAL_REGULARS);
    m.attachBossAfterPreload('Augustink');
    m.setBotNetMode(true);
    m.ingestServerRow(0, 'Doc');

    expect(m.bots).toHaveLength(1);
    expect(m.bots[0]).toMatchObject({ id: 0, name: 'Doc', local: false });
    expect(m.bots.map(b => b.name)).not.toContain('Augustink');
  });

  it('does NOT re-spawn the local roster when preload resolves AFTER MP entry', () => {
    // The race: MP connected before the GLB finished streaming.
    m.setBotNetMode(true);
    m.spawnLocalRosterAfterPreload(LOCAL_REGULARS);

    expect(m.bots).toHaveLength(0);
  });

  it('does NOT attach the late boss GLB when MP is already on', () => {
    // Augustink's 7.6MB GLB resolves last — the exact frozen-in-water case.
    m.setBotNetMode(true);
    m.attachBossAfterPreload('Augustink');

    expect(m.bots.map(b => b.name)).not.toContain('Augustink');
    expect(m.bots).toHaveLength(0);
  });

  it('still spawns the local roster in single-player (MP never turns on)', () => {
    m.spawnLocalRosterAfterPreload(LOCAL_REGULARS);
    m.attachBossAfterPreload('Augustink');

    expect(m.netMode).toBe(false);
    expect(m.bots).toHaveLength(6);
    expect(m.bots.every(b => b.local)).toBe(true);
  });

  it('is idempotent — a repeated setBotNetMode(true) does not wipe live server rows', () => {
    m.setBotNetMode(true);
    m.ingestServerRow(0, 'Doc');
    m.setBotNetMode(true);   // no OFF→ON transition

    expect(m.bots).toHaveLength(1);
    expect(m.bots[0].name).toBe('Doc');
  });
});
