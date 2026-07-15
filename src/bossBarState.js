// src/bossBarState.js — pure boss-bar state decisions for the HUD.
// No DOM/runtime dependencies: this module only normalises the next boss sample,
// decides whether the HUD needs a write, and whether the hit-flash should fire.

const DEFAULT_NAME = 'BOSS';

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function normaliseHp(v) {
  return Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
}

function normaliseMaxHp(v) {
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 1;
}

export function bossBarIdentity(sample) {
  const id = sample?.id;
  if (id != null && id !== '') return `id:${id}`;
  const name = typeof sample?.name === 'string' && sample.name.trim()
    ? sample.name.trim()
    : DEFAULT_NAME;
  return `name:${name}`;
}

export function decideBossBarUpdate(prev, next) {
  if (!next || next.alive !== true) {
    return {
      visible: false,
      changed: !!prev,
      shouldFlash: false,
      identity: '',
      name: DEFAULT_NAME,
      hp: 0,
      maxHp: 1,
      pct: 0,
      alive: false,
    };
  }
  const name = typeof next.name === 'string' && next.name.trim() ? next.name.trim() : DEFAULT_NAME;
  const hp = normaliseHp(next.hp);
  const maxHp = normaliseMaxHp(next.maxHp);
  const pct = clamp01(hp / maxHp);
  const identity = bossBarIdentity({ id: next.id, name });
  const changed = !prev
    || prev.identity !== identity
    || prev.name !== name
    || prev.hp !== hp
    || prev.maxHp !== maxHp
    || prev.alive !== true
    || prev.pct !== pct;
  const shouldFlash = !!prev && prev.alive === true && prev.identity === identity && hp < prev.hp;
  return {
    visible: true,
    changed,
    shouldFlash,
    identity,
    name,
    hp,
    maxHp,
    pct,
    alive: true,
  };
}
