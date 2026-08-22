// ADR-0022 — MP must attach its own GLB models to authoritative rows.
//
// _tickNet materialises every server row as a capsule placeholder, but nothing
// ever upgraded that placeholder to the GLB: `_modelsReady` was set and never
// read, and `_attachModelBot` was reachable only from the SP init path. MP
// therefore worked BY ACCIDENT — it reused the LOCAL roster's already-modelled
// wrappers whenever a server bot id happened to match a local one. Once the
// local roster was correctly removed (ADR-0021), only the purple capsule
// remained: no GLB, no SkinnedMesh, and therefore no per-bone limb colliders.
import { describe, it, expect, beforeEach } from 'vitest';

// Models the real _tickNet upgrade control flow from src/bots.js.
function makeNetTick() {
  const bots = [];
  let modelsReady = false;
  let bossModelReady = false;
  let bossFallbackRegular = false;
  let bossPreloadStarted = false;

  function ensureBossPreload() { bossPreloadStarted = true; }

  function makeCapsuleBot(st) {
    // Capsule placeholder: body + head colliders, but NO model/skinnedMesh,
    // so no per-bone limb colliders can exist.
    const bot = {
      state: st, model: null, capsuleMesh: {},
      bodyCollider: {}, headCollider: {}, boneColliders: [],
    };
    bots.push(bot);
    return bot;
  }

  function attachModelBot(st, renderKind) {
    const bot = bots.find(b => b.state.id === st.id);
    bot.capsuleMesh = null;
    bot.model = {
      kind: renderKind,
      // label mirrors src/bots.js: boss keeps BOSS_NAME, regulars get st.name
      label: renderKind === 'boss' ? null : (st.name || `bot${st.id}`),
      skinnedMesh: {},
    };
    if (bot.model.skinnedMesh && bot.boneColliders.length === 0) {
      bot.boneColliders = [{ bone: 'head' }, { bone: 'arm' }, { bone: 'leg' }];
    }
    return bot;
  }

  function tickNet(poses) {
    for (const p of poses) {
      let bot = bots.find(b => b.state.id === p.id);
      if (!bot) {
        bot = makeCapsuleBot({ id: p.id, kind: p.kind || 'regular', name: p.name || '' });
      }
      // ADR-0022 upgrade block
      if (modelsReady && !bot.model) {
        if (p.kind !== 'boss') attachModelBot(bot.state, 'regular');
        else if (bossModelReady) attachModelBot(bot.state, 'boss');
        else if (bossFallbackRegular) attachModelBot(bot.state, 'regular');
        else ensureBossPreload();
      }
    }
  }

  return {
    bots, tickNet,
    setModelsReady: v => { modelsReady = v; },
    setBossModelReady: v => { bossModelReady = v; },
    setBossFallbackRegular: v => { bossFallbackRegular = v; },
    get bossPreloadStarted() { return bossPreloadStarted; },
  };
}

const DOC = { id: 0, kind: 'regular', name: 'Doc', x: 0, z: 0, alive: true };
const BOSS = { id: 9, kind: 'boss', name: 'Augustink', x: 5, z: 5, alive: true };

describe('ADR-0022 MP attaches its own models', () => {
  let n;
  beforeEach(() => { n = makeNetTick(); });

  it('upgrades the capsule placeholder to the regular GLB once ready', () => {
    n.setModelsReady(true);
    n.tickNet([DOC]);

    expect(n.bots).toHaveLength(1);
    expect(n.bots[0].model).not.toBeNull();
    expect(n.bots[0].model.kind).toBe('regular');
    expect(n.bots[0].capsuleMesh).toBeNull();
  });

  it('builds per-bone limb colliders when the model attaches', () => {
    n.setModelsReady(true);
    n.tickNet([DOC]);

    // This is the reported symptom: capsule-only bots had no limb colliders.
    expect(n.bots[0].model.skinnedMesh).toBeTruthy();
    expect(n.bots[0].boneColliders.length).toBeGreaterThan(0);
  });

  it('keeps the bot as a capsule (no limb colliders) while models are NOT ready', () => {
    n.setModelsReady(false);
    n.tickNet([DOC]);

    expect(n.bots[0].model).toBeNull();
    expect(n.bots[0].boneColliders).toHaveLength(0);
    // still shootable via body/head colliders
    expect(n.bots[0].bodyCollider).toBeTruthy();
    expect(n.bots[0].headCollider).toBeTruthy();
  });

  it('carries the server name onto the nameplate label', () => {
    n.setModelsReady(true);
    n.tickNet([DOC]);

    expect(n.bots[0].model.label).toBe('Doc');
  });

  it('does not attach twice on repeated ticks', () => {
    n.setModelsReady(true);
    n.tickNet([DOC]);
    const first = n.bots[0].model;
    n.tickNet([DOC]);
    n.tickNet([DOC]);

    expect(n.bots).toHaveLength(1);
    expect(n.bots[0].model).toBe(first);
    expect(n.bots[0].boneColliders).toHaveLength(3);
  });

  it('defers the boss and kicks off its preload until the boss GLB lands', () => {
    n.setModelsReady(true);
    n.tickNet([BOSS]);

    expect(n.bots[0].model).toBeNull();       // still a capsule
    expect(n.bossPreloadStarted).toBe(true);

    n.setBossModelReady(true);
    n.tickNet([BOSS]);

    expect(n.bots[0].model.kind).toBe('boss');
  });

  it('falls back to the regular model when the boss GLB fails', () => {
    n.setModelsReady(true);
    n.setBossFallbackRegular(true);
    n.tickNet([BOSS]);

    expect(n.bots[0].model.kind).toBe('regular');
  });

  it('handles a mixed roster in one tick', () => {
    n.setModelsReady(true);
    n.setBossModelReady(true);
    n.tickNet([DOC, BOSS]);

    expect(n.bots).toHaveLength(2);
    expect(n.bots.find(b => b.state.id === 0).model.kind).toBe('regular');
    expect(n.bots.find(b => b.state.id === 9).model.kind).toBe('boss');
  });
});
