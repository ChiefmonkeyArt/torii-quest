// src/ui/leaderboardPanel.js
// MP-3 (v0.2.366-alpha) — pure render helpers for the leaderboard panel.
// UI is deliberately data-first: renderLeaderboardRows() returns a plain array
// of {rank, npub, kills, kd, damage, matches} objects; the DOM wrapper below
// is thin and only touches an injected document to stay testable.
// SPDX-License-Identifier: MIT

import { aggregate, topN } from '../engine/multiplayer/leaderboardAgg.js';

/**
 * Shorten a hex pubkey for display. First 6 + last 4 chars with an ellipsis.
 */
export function shortenNpub(npub) {
  if (typeof npub !== 'string' || npub.length < 12) return String(npub || '');
  return `${npub.slice(0, 6)}…${npub.slice(-4)}`;
}

/**
 * Format an event with kills/deaths/damage etc. for display.
 */
export function formatRow(row, rank) {
  const kd = row.lifetimeDeaths > 0
    ? (row.lifetimeKills / row.lifetimeDeaths).toFixed(2)
    : row.lifetimeKills.toFixed(2);
  return {
    rank,
    npub:    row.npub,
    display: shortenNpub(row.npub),
    kills:   row.lifetimeKills,
    deaths:  row.lifetimeDeaths,
    kd,
    damage:  row.lifetimeDamage,
    matches: row.matches,
    lastSeen: row.lastSeen,
  };
}

/**
 * Return a flat display array for a panel.
 * @param {{ current: any[], history: any[] }} inputs
 * @param {number} [limit=20]
 */
export function renderLeaderboardRows(inputs, limit = 20) {
  const top = topN(inputs, limit);
  return top.map((r, i) => formatRow(r, i + 1));
}

/**
 * Render for the dashboard tile: top-5, minimal fields.
 */
export function renderDashboardTile(inputs) {
  const top = topN(inputs, 5);
  return top.map((r, i) => ({
    rank:  i + 1,
    display: shortenNpub(r.npub),
    kills: r.lifetimeKills,
    kd:    r.lifetimeDeaths > 0
             ? (r.lifetimeKills / r.lifetimeDeaths).toFixed(2)
             : r.lifetimeKills.toFixed(2),
  }));
}

/**
 * Thin DOM helper — call this once with a container element to install the
 * leaderboard panel. Returns { update(inputs), destroy() }.
 * The DOM structure is intentionally tiny so styling lives elsewhere.
 */
export function mountLeaderboardPanel(container, opts = {}) {
  if (!container || typeof container.appendChild !== 'function') {
    throw new TypeError('mountLeaderboardPanel: container required');
  }
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 20;

  const doc = container.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) throw new Error('mountLeaderboardPanel: no document available');

  const root = doc.createElement('div');
  root.className = 'tq-leaderboard-panel';
  root.dataset.mp3 = 'v0.2.366-alpha';

  const title = doc.createElement('div');
  title.className = 'tq-leaderboard-title';
  title.textContent = opts.title || 'Leaderboard · Torii Quest';
  root.appendChild(title);

  const list = doc.createElement('ol');
  list.className = 'tq-leaderboard-list';
  root.appendChild(list);

  const empty = doc.createElement('div');
  empty.className = 'tq-leaderboard-empty';
  empty.textContent = 'No scores yet — play a match to get on the board.';
  empty.style.display = 'none';
  root.appendChild(empty);

  container.appendChild(root);

  function update(inputs) {
    const rows = renderLeaderboardRows(inputs, limit);
    // clear
    while (list.firstChild) list.removeChild(list.firstChild);
    if (rows.length === 0) {
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';
    for (const r of rows) {
      const li = doc.createElement('li');
      li.className = 'tq-leaderboard-row';
      li.dataset.npub = r.npub;
      li.innerHTML = ''; // stay defensive
      const rank = doc.createElement('span'); rank.className = 'tq-lb-rank';  rank.textContent = `#${r.rank}`;
      const name = doc.createElement('span'); name.className = 'tq-lb-name';  name.textContent = r.display;
      const stat = doc.createElement('span'); stat.className = 'tq-lb-stats'; stat.textContent = `K ${r.kills} · D ${r.deaths} · K/D ${r.kd} · dmg ${r.damage}`;
      li.appendChild(rank); li.appendChild(name); li.appendChild(stat);
      list.appendChild(li);
    }
  }

  function destroy() {
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  return { update, destroy, root };
}

// Convenience re-exports so callers only import from one module.
export { aggregate, topN };
