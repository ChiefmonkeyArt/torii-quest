// tests/multiplayer/arena-leaderboard.test.js — v0.2.380-alpha
// The in-arena leaderboard overlay wiring: server-tally → LOCAL render, GLOBAL
// relay read-back (ok / empty / offline-cache), opt-in publish proxy, toggle +
// teardown. Node-only, tiny inline DOM stub (no jsdom) — the module is DOM-only
// and every impure edge (document, relay read, publish, login) is injected.
import { describe, it, expect, vi } from 'vitest';
import { createArenaLeaderboard, talliesToCurrentEvents } from '../../src/engine/multiplayer/arenaLeaderboard.js';
import { aggregate } from '../../src/engine/multiplayer/leaderboardAgg.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const SESS = '2'.repeat(16);

function fakeElement(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    childNodes: [],
    firstChild: null,
    parentNode: null,
    className: '',
    textContent: '',
    innerHTML: '',
    type: '',
    disabled: false,
    style: {},
    dataset: {},
    ownerDocument: null,
    _listeners: {},
    appendChild(child) {
      child.parentNode = el;
      el.childNodes.push(child);
      el.firstChild = el.childNodes[0];
      return child;
    },
    removeChild(child) {
      const i = el.childNodes.indexOf(child);
      if (i >= 0) el.childNodes.splice(i, 1);
      el.firstChild = el.childNodes[0] || null;
      child.parentNode = null;
      return child;
    },
    addEventListener(type, fn) {
      (el._listeners[type] || (el._listeners[type] = [])).push(fn);
    },
  };
  return el;
}
function fireClick(el) { (el._listeners.click || []).forEach((fn) => fn({})); }
function fakeDoc() {
  const doc = {
    createElement: (tag) => { const el = fakeElement(tag); el.ownerDocument = doc; return el; },
  };
  doc.body = fakeElement('body'); doc.body.ownerDocument = doc;
  return doc;
}

// Walk the overlay tree for the first element matching a className.
function find(root, className) {
  if (root.className === className) return root;
  for (const c of root.childNodes) { const hit = find(c, className); if (hit) return hit; }
  return null;
}
function localRows(lb) {
  const list = find(lb.root, 'tq-leaderboard-list');
  return list ? list.childNodes : [];
}
function globalRows(lb) {
  const list = find(lb.root, 'tq-arena-lb-global-list');
  return list ? list.childNodes : [];
}

function frame(tallies) { return { t: 'SCORE', sessionId: SESS, endedAt: 1_700_000_000_000, tallies }; }

describe('talliesToCurrentEvents', () => {
  it('maps server tallies into aggregate-parseable current events', () => {
    const tallies = [
      { id: 'p1', npub: A, kills: 3, deaths: 1, damage: 40 },
      { id: 'p2', npub: B, kills: 1, deaths: 2, damage: 15 },
    ];
    const current = talliesToCurrentEvents(tallies, SESS, 1_700_000_000_000);
    expect(current).toHaveLength(2);
    // Feeds cleanly through the pure aggregator (matches=0 → lifetime=current).
    const rows = aggregate({ current, history: [] });
    expect(rows[0].npub).toBe(A);
    expect(rows[0].lifetimeKills).toBe(3);
    expect(rows[0].lifetimeDamage).toBe(40);
  });
  it('drops tallies whose npub is not 64-hex and clamps counts', () => {
    const current = talliesToCurrentEvents(
      [{ id: 'x', npub: 'not-hex', kills: 5 }, { id: 'p1', npub: A, kills: -3, deaths: 2, damage: 1e9 }],
      SESS, 0,
    );
    expect(current).toHaveLength(1);
    const body = JSON.parse(current[0].content);
    expect(body.kills).toBe(0);   // negative clamped
    expect(body.damage).toBe(1e6); // over-cap clamped
    expect(body.sessionId).toBe(SESS);
  });
  it('substitutes a placeholder session id when the frame id is malformed', () => {
    const current = talliesToCurrentEvents([{ npub: A, kills: 1 }], 'bad', 0);
    expect(JSON.parse(current[0].content).sessionId).toBe('0000000000000000');
  });
});

describe('createArenaLeaderboard — LOCAL live tallies', () => {
  it('renders server tallies with NO signer / no login', () => {
    const doc = fakeDoc();
    const lb = createArenaLeaderboard({ document: doc, mount: doc.body /* canPublish defaults false */ });
    lb.show();
    lb.setLiveScore(frame([
      { id: 'p1', npub: A, kills: 4, deaths: 0, damage: 50 },
      { id: 'p2', npub: B, kills: 2, deaths: 3, damage: 20 },
    ]));
    const rows = localRows(lb);
    expect(rows).toHaveLength(2);
    expect(rows[0].dataset.npub).toBe(A); // top fragger first
  });

  it('stores frames received while hidden and paints them on show', () => {
    const doc = fakeDoc();
    const lb = createArenaLeaderboard({ document: doc, mount: doc.body });
    lb.setLiveScore(frame([{ id: 'p1', npub: A, kills: 1, deaths: 0, damage: 10 }]));
    expect(lb.isOpen()).toBe(false);
    lb.show();
    expect(localRows(lb)).toHaveLength(1);
  });
});

describe('createArenaLeaderboard — GLOBAL relay read-back', () => {
  const okRows = [
    { rank: 1, runId: A, score: 999, kills: 9, headshots: 3, accuracyLabel: '80.0%', version: 'v0.2.380-alpha' },
  ];
  it('renders rows when the relay read succeeds', async () => {
    const doc = fakeDoc();
    const fetchGlobal = vi.fn(async () => ({ ok: true, rows: okRows }));
    const lb = createArenaLeaderboard({ document: doc, mount: doc.body, fetchGlobal });
    lb.show();
    lb.setTab('global');
    await lb.refreshGlobal();
    expect(fetchGlobal).toHaveBeenCalled();
    expect(globalRows(lb)).toHaveLength(1);
  });

  it('shows an empty state when the relay returns no scores', async () => {
    const doc = fakeDoc();
    const lb = createArenaLeaderboard({ document: doc, mount: doc.body, fetchGlobal: async () => ({ ok: true, rows: [] }) });
    lb.show(); lb.setTab('global');
    await lb.refreshGlobal();
    expect(globalRows(lb)).toHaveLength(0);
    expect(find(lb.root, 'tq-arena-lb-global-msg').textContent).toMatch(/No published scores/i);
  });

  it('keeps last-known rows and flags offline when the relay fails', async () => {
    const doc = fakeDoc();
    let mode = 'ok';
    const fetchGlobal = async () => (mode === 'ok' ? { ok: true, rows: okRows } : { ok: false, offline: true, rows: [] });
    const lb = createArenaLeaderboard({ document: doc, mount: doc.body, fetchGlobal });
    lb.show(); lb.setTab('global');
    await lb.refreshGlobal();
    expect(globalRows(lb)).toHaveLength(1);
    mode = 'offline';
    await lb.refreshGlobal();
    // cache retained; offline banner shown
    expect(globalRows(lb)).toHaveLength(1);
    expect(find(lb.root, 'tq-arena-lb-global-msg').textContent).toMatch(/offline/i);
  });

  it('never throws when fetchGlobal rejects', async () => {
    const doc = fakeDoc();
    const lb = createArenaLeaderboard({ document: doc, mount: doc.body, fetchGlobal: async () => { throw new Error('boom'); } });
    lb.show(); lb.setTab('global');
    await expect(lb.refreshGlobal()).resolves.toBeUndefined();
    expect(globalRows(lb)).toHaveLength(0);
  });
});

describe('createArenaLeaderboard — opt-in publish proxy', () => {
  it('invokes onPublish only on an explicit click, and gates on canPublish', () => {
    const doc = fakeDoc();
    const onPublish = vi.fn();
    let loggedIn = false;
    const lb = createArenaLeaderboard({ document: doc, mount: doc.body, onPublish, canPublish: () => loggedIn });
    lb.show();
    const btn = find(lb.root, 'tq-arena-lb-publish');
    expect(btn.disabled).toBe(true);         // not logged in → disabled
    expect(onPublish).not.toHaveBeenCalled(); // never auto-fires
    loggedIn = true;
    lb.hide(); lb.show();                      // re-evaluates canPublish on show
    expect(btn.disabled).toBe(false);
    fireClick(btn);
    expect(onPublish).toHaveBeenCalledTimes(1);
  });
});

describe('createArenaLeaderboard — toggle + teardown', () => {
  it('toggles visibility and tears the overlay out of the DOM', () => {
    const doc = fakeDoc();
    const lb = createArenaLeaderboard({ document: doc, mount: doc.body });
    expect(lb.isOpen()).toBe(false);
    expect(lb.root.style.display).toBe('none');
    lb.toggle();
    expect(lb.isOpen()).toBe(true);
    expect(lb.root.style.display).toBe('');
    lb.toggle();
    expect(lb.isOpen()).toBe(false);
    expect(doc.body.childNodes).toContain(lb.root);
    lb.destroy();
    expect(doc.body.childNodes).not.toContain(lb.root);
  });
});
