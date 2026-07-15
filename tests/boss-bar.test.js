import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { decideBossBarUpdate, decideBossEngagement } from '../src/bossBarState.js';

function fakeClassList() {
  const set = new Set();
  return {
    add: (...names) => names.forEach((name) => set.add(name)),
    remove: (...names) => names.forEach((name) => set.delete(name)),
    toggle(name, force) {
      if (force === true) { set.add(name); return true; }
      if (force === false) { set.delete(name); return false; }
      if (set.has(name)) { set.delete(name); return false; }
      set.add(name);
      return true;
    },
    contains: (name) => set.has(name),
  };
}

function fakeElement(tag = 'div') {
  return {
    tagName: String(tag).toUpperCase(),
    style: {},
    children: [],
    classList: fakeClassList(),
    attributes: {},
    parentElement: null,
    textContent: '',
    id: '',
    ownerDocument: null,
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) this.children.splice(idx, 1);
      child.parentElement = null;
      return child;
    },
    remove() {
      if (this.parentElement) this.parentElement.removeChild(this);
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
  };
}

function fakeHudDocument() {
  const doc = {
    nodes: new Map(),
    createElement(tag) {
      const el = fakeElement(tag);
      el.ownerDocument = doc;
      return el;
    },
    getElementById(id) {
      return this.nodes.get(id) || null;
    },
  };
  doc.body = fakeElement('body');
  doc.body.ownerDocument = doc;
  const ids = ['sb-sats', 'sb-kills', 'sb-hp', 'ammo-cur', 'healthbar-fill', 'hit-flash', 'death-msg', 'crosshair', 'killfeed'];
  for (const id of ids) {
    const el = fakeElement('div');
    el.id = id;
    el.ownerDocument = doc;
    doc.nodes.set(id, el);
  }
  doc.nodes.get('ammo-cur').parentElement = fakeElement('div');
  return doc;
}

describe('decideBossBarUpdate', () => {
  it('does not flash on the first visible sample', () => {
    const next = decideBossBarUpdate(null, { id: 9, name: 'Augustink', hp: 60, maxHp: 60, alive: true });
    expect(next.visible).toBe(true);
    expect(next.changed).toBe(true);
    expect(next.shouldFlash).toBe(false);
    expect(next.pct).toBe(1);
  });

  it('flashes when the same boss loses HP', () => {
    const prev = decideBossBarUpdate(null, { id: 9, name: 'Augustink', hp: 60, maxHp: 60, alive: true });
    const next = decideBossBarUpdate(prev, { id: 9, name: 'Augustink', hp: 48, maxHp: 60, alive: true });
    expect(next.shouldFlash).toBe(true);
    expect(next.changed).toBe(true);
    expect(next.pct).toBe(0.8);
  });

  it('does not flash when HP increases', () => {
    const prev = decideBossBarUpdate(null, { id: 9, name: 'Augustink', hp: 40, maxHp: 60, alive: true });
    const next = decideBossBarUpdate(prev, { id: 9, name: 'Augustink', hp: 52, maxHp: 60, alive: true });
    expect(next.shouldFlash).toBe(false);
    expect(next.changed).toBe(true);
  });

  it('does not flash when the boss identity changes', () => {
    const prev = decideBossBarUpdate(null, { id: 9, name: 'Augustink', hp: 40, maxHp: 60, alive: true });
    const next = decideBossBarUpdate(prev, { id: 10, name: 'A Different Boss', hp: 35, maxHp: 60, alive: true });
    expect(next.shouldFlash).toBe(false);
    expect(next.changed).toBe(true);
  });
});

describe('decideBossEngagement', () => {
  it('hides when the player is far and no recent hit happened', () => {
    const next = decideBossEngagement({
      dist: 18,
      bossHp: 60,
      prevBossHp: 60,
      now: 10_000,
      lastHitMs: -Infinity,
      engageRange: 14,
      recentHitMs: 4_000,
    });
    expect(next.engaged).toBe(false);
    expect(next.newLastHitMs).toBe(-Infinity);
  });

  it('shows when the player is within range', () => {
    const next = decideBossEngagement({
      dist: 12,
      bossHp: 60,
      prevBossHp: 60,
      now: 10_000,
      lastHitMs: -Infinity,
      engageRange: 14,
      recentHitMs: 4_000,
    });
    expect(next.engaged).toBe(true);
  });

  it('stays visible after a far-away HP drop', () => {
    const next = decideBossEngagement({
      dist: 18,
      bossHp: 54,
      prevBossHp: 60,
      now: 10_000,
      lastHitMs: -Infinity,
      engageRange: 14,
      recentHitMs: 4_000,
    });
    expect(next.engaged).toBe(true);
    expect(next.newLastHitMs).toBe(10_000);
  });

  it('hides once the recent-hit timeout expires', () => {
    const next = decideBossEngagement({
      dist: 18,
      bossHp: 54,
      prevBossHp: 54,
      now: 14_100,
      lastHitMs: 10_000,
      engageRange: 14,
      recentHitMs: 4_000,
    });
    expect(next.engaged).toBe(false);
    expect(next.newLastHitMs).toBe(10_000);
  });
});

describe('setBossBar', () => {
  const oldDocument = globalThis.document;
  const oldWindow = globalThis.window;
  const oldWidth = globalThis.innerWidth;
  const oldHeight = globalThis.innerHeight;

  beforeEach(() => {
    vi.resetModules();
    globalThis.document = fakeHudDocument();
    globalThis.window = globalThis;
    globalThis.innerWidth = 1280;
    globalThis.innerHeight = 720;
  });

  afterEach(() => {
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
    if (oldWindow === undefined) delete globalThis.window;
    else globalThis.window = oldWindow;
    if (oldWidth === undefined) delete globalThis.innerWidth;
    else globalThis.innerWidth = oldWidth;
    if (oldHeight === undefined) delete globalThis.innerHeight;
    else globalThis.innerHeight = oldHeight;
  });

  it('updates the floating anchor every frame even when HP is unchanged', async () => {
    const hud = await import('../src/hud.js');
    hud.setBossBar({
      id: 9,
      name: 'Augustink',
      hp: 60,
      maxHp: 60,
      alive: true,
      screenX: 400,
      screenY: 240,
      anchored: true,
    });
    hud.setBossBar({
      id: 9,
      name: 'Augustink',
      hp: 60,
      maxHp: 60,
      alive: true,
      screenX: 436,
      screenY: 208,
      anchored: true,
    });

    const bar = globalThis.document.body.children.find((child) => child.id === 'boss-hp-bar');
    expect(bar).toBeTruthy();
    expect(bar.style.left).toBe('436px');
    expect(bar.style.top).toBe('208px');
    expect(bar.style.transform).toBe('translate(-50%, -100%)');
    expect(bar.style.opacity).toBe('1');
  });
});
