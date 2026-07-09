// tests/ui/leaderboard-panel.test.js — MP-3 (v0.2.366-alpha)
// Uses a tiny inline DOM stub — the panel is data-first and only touches
// createElement/appendChild/removeChild, so we don't need jsdom.
import { describe, it, expect } from 'vitest';
import {
  renderLeaderboardRows, renderDashboardTile, shortenNpub, formatRow, mountLeaderboardPanel,
} from '../../src/ui/leaderboardPanel.js';

function fakeElement(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    childNodes: [],
    firstChild: null,
    parentNode: null,
    className: '',
    textContent: '',
    innerHTML: '',
    style: {},
    dataset: {},
    ownerDocument: null,
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
  };
  return el;
}

function fakeDoc() {
  const doc = {
    createElement: (tag) => {
      const el = fakeElement(tag);
      el.ownerDocument = doc;
      return el;
    },
  };
  return doc;
}

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const HEX16 = (n) => n.toString(16).padStart(16, '0');
function evt(pk, kind, kills, deaths, damage, sess, ts) {
  return { pubkey: pk, kind, created_at: ts,
           content: JSON.stringify({ kills, deaths, damage, sessionId: sess, endedAt: ts * 1000 }) };
}

describe('shortenNpub', () => {
  it('truncates 64-hex to a display key', () => {
    expect(shortenNpub(A)).toBe('aaaaaa…aaaa');
  });
  it('passes through short values', () => {
    expect(shortenNpub('abc')).toBe('abc');
    expect(shortenNpub(null)).toBe('');
  });
});

describe('formatRow', () => {
  it('computes K/D=lifetimeKills when deaths=0', () => {
    const row = formatRow({
      npub: A, lifetimeKills: 5, lifetimeDeaths: 0, lifetimeDamage: 30,
      matches: 2, lastSeen: 100,
    }, 1);
    expect(row.kd).toBe('5.00');
    expect(row.display).toBe(shortenNpub(A));
  });
  it('formats K/D=kills/deaths when deaths>0', () => {
    const row = formatRow({
      npub: A, lifetimeKills: 5, lifetimeDeaths: 2, lifetimeDamage: 30,
      matches: 2, lastSeen: 100,
    }, 1);
    expect(row.kd).toBe('2.50');
  });
});

describe('renderLeaderboardRows / renderDashboardTile', () => {
  const inputs = {
    current: [],
    history: [
      evt(A, 1, 10, 2, 200, HEX16(1), 1000),
      evt(B, 1, 4, 5, 100, HEX16(2), 1100),
    ],
  };
  it('returns ranked rows with limit', () => {
    const rows = renderLeaderboardRows(inputs, 20);
    expect(rows[0].rank).toBe(1);
    expect(rows[0].npub).toBe(A);
    expect(rows[0].kills).toBe(10);
    expect(rows).toHaveLength(2);
  });
  it('dashboard tile clips to 5 rows', () => {
    const many = { current: [],
      history: Array.from({ length: 8 }, (_, i) =>
        evt(('e'.repeat(63) + i.toString(16)), 1, 10 - i, 0, 0, HEX16(i), 1000 + i)) };
    expect(renderDashboardTile(many)).toHaveLength(5);
  });
});

describe('mountLeaderboardPanel — DOM plumbing', () => {
  it('appends a root, renders rows, and destroys cleanly', () => {
    const doc = fakeDoc();
    const container = fakeElement('div');
    container.ownerDocument = doc;
    const panel = mountLeaderboardPanel(container, { limit: 5, title: 'Top Quests' });
    const inputs = { current: [], history: [ evt(A, 1, 2, 1, 30, HEX16(1), 1000) ] };
    panel.update(inputs);
    // root is appended
    expect(container.childNodes).toHaveLength(1);
    const root = container.childNodes[0];
    expect(root.dataset.mp3).toBe('v0.2.366-alpha');
    // rows list is populated
    const list = root.childNodes.find((c) => c.tagName === 'OL');
    expect(list.childNodes).toHaveLength(1);
    panel.destroy();
    expect(container.childNodes).toHaveLength(0);
  });

  it('shows the empty state when no rows', () => {
    const doc = fakeDoc();
    const container = fakeElement('div');
    container.ownerDocument = doc;
    const panel = mountLeaderboardPanel(container);
    panel.update({ current: [], history: [] });
    const root = container.childNodes[0];
    const empty = root.childNodes.find((c) => c.className === 'tq-leaderboard-empty');
    expect(empty.style.display).toBe('');
  });

  it('rejects a bad container', () => {
    expect(() => mountLeaderboardPanel(null)).toThrow(/container required/);
  });
});
