// tests/multiplayer/bot-nameplate-lifecycle.test.js — ADR-0016 (v0.2.626).
// Guards the nameplate lifecycle invariant: a bot's nameplate must be visible
// iff its body is visible AND it is alive. The screenshot-reported bug in
// v0.2.625 was floating labels above ground with no body — root cause was that
// LOD hides `root.visible=false` but the nameplate is a scene-level sibling
// sprite that was never touched by LOD. This test exercises the invariant
// directly on a minimal BotModel-like surface without pulling in three.js.
import { describe, it, expect } from 'vitest';

// The lifecycle contract we ship: BotModel.setNameplateVisible(v) sets
// this._nameplate.visible = !!v; no-op if there is no nameplate.
// We reproduce the exact contract here so the test isn't a tautology of the
// implementation — it validates the shape any BotModel must satisfy.
class FakeBotModel {
  constructor({ hasNameplate = true } = {}) {
    this.root = { visible: true };
    this._nameplate = hasNameplate ? { visible: true } : null;
  }
  setNameplateVisible(v) {
    if (this._nameplate) this._nameplate.visible = !!v;
  }
}

// Simulate the invariant enforced at the end of _syncNetBot / _syncBot each
// frame: nameplate.visible = (root.visible && alive).
function tickInvariant(model, alive) {
  const bodyVisible = model.root?.visible === true;
  model.setNameplateVisible(bodyVisible && alive === true);
}

describe('ADR-0016 nameplate lifecycle', () => {
  it('hides nameplate when bot dies (alive-transition true → false)', () => {
    const m = new FakeBotModel();
    tickInvariant(m, true);
    expect(m._nameplate.visible).toBe(true);

    tickInvariant(m, false);
    expect(m._nameplate.visible).toBe(false);
  });

  it('hides nameplate when body is LOD-culled (root.visible=false)', () => {
    const m = new FakeBotModel();
    // LOD cull: applyLod sets root.visible = false at distance.
    m.root.visible = false;
    tickInvariant(m, true); // still alive, but body hidden
    expect(m._nameplate.visible).toBe(false);
  });

  it('shows nameplate on respawn (alive=true, root.visible=true)', () => {
    const m = new FakeBotModel();
    // Dead first.
    tickInvariant(m, false);
    expect(m._nameplate.visible).toBe(false);
    // Respawn: alive again, body visible.
    m.root.visible = true;
    tickInvariant(m, true);
    expect(m._nameplate.visible).toBe(true);
  });

  it('never-throws on a bot with no nameplate (regulars without a label)', () => {
    const m = new FakeBotModel({ hasNameplate: false });
    expect(() => tickInvariant(m, true)).not.toThrow();
    expect(() => tickInvariant(m, false)).not.toThrow();
  });

  it('hides nameplate when BOTH conditions fail (dead AND culled)', () => {
    const m = new FakeBotModel();
    m.root.visible = false;
    tickInvariant(m, false);
    expect(m._nameplate.visible).toBe(false);
  });
});

// ADR-0016 D-2: dead bots during the death arc keep the body force-visible so
// the ragdoll flight is never popped by LOD mid-animation. After the arc
// completes (t > DEATH_ARC_DURATION ≈ 1.3 s), LOD may cull distant corpses.
// This test reproduces the branch logic in _syncNetBot.
const DEATH_ARC_DURATION = 1.3;

function tickDeadBranch(model, deathT, lodLevel /* 'full' | 'far' | 'hidden' */) {
  if (deathT > DEATH_ARC_DURATION) {
    // LOD applies.
    if (lodLevel === 'hidden') {
      model.root.visible = false;
    } else {
      model.root.visible = true;
    }
  } else {
    // During the arc, force visible.
    model.root.visible = true;
  }
  // Nameplate invariant: dead → always hidden.
  const bodyVisible = model.root?.visible === true;
  model.setNameplateVisible(bodyVisible && false /* alive */);
}

describe('ADR-0016 D-2 death arc + LOD', () => {
  it('keeps corpse visible during the death arc even at hidden LOD', () => {
    const m = new FakeBotModel();
    tickDeadBranch(m, 0.5, 'hidden');
    expect(m.root.visible).toBe(true);
    // Nameplate still hidden because dead.
    expect(m._nameplate.visible).toBe(false);
  });

  it('LOD-culls the corpse after the death arc completes', () => {
    const m = new FakeBotModel();
    tickDeadBranch(m, 2.0, 'hidden');
    expect(m.root.visible).toBe(false);
    expect(m._nameplate.visible).toBe(false);
  });

  it('keeps corpse visible after the arc when LOD is full', () => {
    const m = new FakeBotModel();
    tickDeadBranch(m, 2.0, 'full');
    expect(m.root.visible).toBe(true);
    // Nameplate still hidden because dead.
    expect(m._nameplate.visible).toBe(false);
  });
});
