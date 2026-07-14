// src/engine/multiplayer/arenaLeaderboard.js
// v0.2.380-alpha — the in-arena leaderboard overlay: wiring layer that turns the
// pre-existing PURE pieces into a live, toggleable panel with two tabs.
//
//   • LOCAL  — server-authoritative live tallies (the SCORE frames the server
//              now broadcasts on every kill + a ~5s tick). Rendered through the
//              existing pure leaderboardPanel/leaderboardAgg. 0 signer prompts,
//              session-scoped, works with NO Nostr login (the tally npubs come
//              from the server, not from the local signer).
//   • GLOBAL — read-only Nostr relay read-back of published kind-30000 score
//              events, via the pure leaderboardRelayRead model. READ-ONLY: no
//              signer, no prompts, graceful offline/empty state, cached rows.
//
// The footer PUBLISH button is a thin proxy for the already-wired opt-in Nostr
// publish handler (main.js #leaderboard-publish-btn) — it NEVER duplicates the
// publish/sign logic and NEVER auto-fires; a click is the explicit consent.
//
// This module is DOM-only (no THREE) and every impure edge — the document, the
// live relay read, the publish click, and the login check — is INJECTED, so it
// unit-tests in node with fakes. See tests/multiplayer/arena-leaderboard.test.js.
// SPDX-License-Identifier: MIT

import { mountLeaderboardPanel, shortenNpub } from '../../ui/leaderboardPanel.js';

const HEX64 = /^[0-9a-f]{64}$/;
const HEX16 = /^[0-9a-f]{16}$/;

function _clampCount(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const i = Math.floor(n);
  if (i < 0) return 0;
  if (i > 1e6) return 1e6;
  return i;
}

// talliesToCurrentEvents(tallies, sessionId, endedAtMs) → synthetic kind:30078-
// shaped "current" events the pure leaderboardAgg.aggregate() understands. The
// server tally shape is { id, npub, kills, deaths, damage }; only tallies with a
// well-formed 64-hex npub survive (aggregate ignores the rest anyway). Pure.
export function talliesToCurrentEvents(tallies, sessionId, endedAtMs) {
  const list = Array.isArray(tallies) ? tallies : [];
  const ended = Number.isFinite(endedAtMs) && endedAtMs >= 0 ? endedAtMs : Date.now();
  const createdAt = Math.floor(ended / 1000);
  const sess = typeof sessionId === 'string' && HEX16.test(sessionId) ? sessionId : '0000000000000000';
  const out = [];
  for (const t of list) {
    const npub = t && typeof t.npub === 'string' ? t.npub : '';
    if (!HEX64.test(npub)) continue;
    out.push({
      pubkey: npub,
      created_at: createdAt,
      content: JSON.stringify({
        kills: _clampCount(t.kills),
        deaths: _clampCount(t.deaths),
        damage: _clampCount(t.damage),
        endedAt: ended,
        sessionId: sess,
      }),
    });
  }
  return out;
}

/**
 * @param {object} opts
 * @param {Document} [opts.document]     injected document (defaults to global)
 * @param {Element}  [opts.mount]        parent to append the overlay to (defaults document.body)
 * @param {Function} [opts.fetchGlobal]  async () => { ok, rows, offline?, count? } — live relay read.
 *                                        Defaults to an offline stub so node tests need no network.
 * @param {Function} [opts.onPublish]    () => void — invoked when the footer PUBLISH button is clicked.
 * @param {Function} [opts.canPublish]   () => boolean — whether the opt-in publish is available (logged in).
 * @param {number}   [opts.limit]        max rows (default 20)
 */
export function createArenaLeaderboard(opts = {}) {
  const doc = opts.document || (typeof document !== 'undefined' ? document : null);
  if (!doc) throw new Error('createArenaLeaderboard: no document available');
  const fetchGlobal = typeof opts.fetchGlobal === 'function'
    ? opts.fetchGlobal
    : async () => ({ ok: false, offline: true, rows: [] });
  const onPublish = typeof opts.onPublish === 'function' ? opts.onPublish : () => {};
  const canPublish = typeof opts.canPublish === 'function' ? opts.canPublish : () => false;
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 20;

  let open = false;
  let activeTab = 'local';
  let liveInputs = { current: [], history: [] };
  let globalRows = [];        // cached last-known GLOBAL rows
  let globalStatus = 'idle';  // idle | loading | ok | empty | offline
  let globalSeq = 0;          // guards against out-of-order async responses

  // ── DOM ──────────────────────────────────────────────────────────────────
  const root = doc.createElement('div');
  root.className = 'tq-arena-lb';
  root.dataset.v380 = 'v0.2.380-alpha';
  root.style.display = 'none';

  const tabs = doc.createElement('div');
  tabs.className = 'tq-arena-lb-tabs';
  const tabLocal = doc.createElement('button');
  tabLocal.type = 'button';
  tabLocal.className = 'tq-arena-lb-tab';
  tabLocal.textContent = 'LIVE (this arena)';
  const tabGlobal = doc.createElement('button');
  tabGlobal.type = 'button';
  tabGlobal.className = 'tq-arena-lb-tab';
  tabGlobal.textContent = 'GLOBAL (Nostr)';
  tabs.appendChild(tabLocal);
  tabs.appendChild(tabGlobal);
  root.appendChild(tabs);

  // LOCAL: reuse the pure leaderboard panel.
  const localHost = doc.createElement('div');
  localHost.className = 'tq-arena-lb-local';
  root.appendChild(localHost);
  const localPanel = mountLeaderboardPanel(localHost, { title: 'This server · session standings', limit });

  // GLOBAL: our own list (different row shape — score/kills/headshots/accuracy).
  const globalHost = doc.createElement('div');
  globalHost.className = 'tq-arena-lb-global';
  globalHost.style.display = 'none';
  const globalTitle = doc.createElement('div');
  globalTitle.className = 'tq-arena-lb-global-title';
  globalTitle.textContent = 'Global leaderboard · Nostr';
  const globalList = doc.createElement('ol');
  globalList.className = 'tq-arena-lb-global-list';
  const globalMsg = doc.createElement('div');
  globalMsg.className = 'tq-arena-lb-global-msg';
  globalHost.appendChild(globalTitle);
  globalHost.appendChild(globalList);
  globalHost.appendChild(globalMsg);
  root.appendChild(globalHost);

  // Footer: opt-in publish proxy + a read-only hint.
  const footer = doc.createElement('div');
  footer.className = 'tq-arena-lb-footer';
  const publishBtn = doc.createElement('button');
  publishBtn.type = 'button';
  publishBtn.className = 'tq-arena-lb-publish';
  publishBtn.textContent = 'PUBLISH MY SCORE';
  const hint = doc.createElement('span');
  hint.className = 'tq-arena-lb-hint';
  hint.textContent = 'L / Tab to toggle · publish is opt-in (Nostr)';
  footer.appendChild(publishBtn);
  footer.appendChild(hint);
  root.appendChild(footer);

  publishBtn.addEventListener('click', () => { try { onPublish(); } catch { /* never break the loop */ } });
  tabLocal.addEventListener('click', () => setTab('local'));
  tabGlobal.addEventListener('click', () => setTab('global'));

  const mountPoint = opts.mount || doc.body;
  if (mountPoint && typeof mountPoint.appendChild === 'function') mountPoint.appendChild(root);

  _renderTabs();
  _renderLocal();

  // ── rendering ──────────────────────────────────────────────────────────────
  function _renderTabs() {
    tabLocal.dataset.active = activeTab === 'local' ? 'true' : 'false';
    tabGlobal.dataset.active = activeTab === 'global' ? 'true' : 'false';
    localHost.style.display = activeTab === 'local' ? '' : 'none';
    globalHost.style.display = activeTab === 'global' ? '' : 'none';
  }

  function _renderLocal() {
    localPanel.update(liveInputs);
  }

  function _renderPublish() {
    const ok = !!canPublish();
    publishBtn.disabled = !ok;
    publishBtn.dataset.ready = ok ? 'true' : 'false';
  }

  function _renderGlobal() {
    while (globalList.firstChild) globalList.removeChild(globalList.firstChild);
    if (globalStatus === 'loading' && globalRows.length === 0) {
      globalMsg.style.display = '';
      globalMsg.textContent = 'Loading global scores…';
      return;
    }
    if (globalRows.length === 0) {
      globalMsg.style.display = '';
      globalMsg.textContent = globalStatus === 'offline'
        ? 'Relay offline — showing no global scores. Your local board still works.'
        : 'No published scores yet — publish yours to get on the board.';
      return;
    }
    globalMsg.style.display = globalStatus === 'offline' ? '' : 'none';
    if (globalStatus === 'offline') globalMsg.textContent = 'Relay offline — showing last known scores.';
    for (const r of globalRows) {
      const li = doc.createElement('li');
      li.className = 'tq-arena-lb-global-row';
      const rank = doc.createElement('span'); rank.className = 'tq-lb-rank'; rank.textContent = `#${r.rank}`;
      const who = doc.createElement('span'); who.className = 'tq-lb-name';
      who.textContent = r.runId ? shortenNpub(String(r.runId)) : '—';
      const stat = doc.createElement('span'); stat.className = 'tq-lb-stats';
      stat.textContent = `score ${r.score} · K ${r.kills} · HS ${r.headshots} · ${r.accuracyLabel}`;
      li.appendChild(rank); li.appendChild(who); li.appendChild(stat);
      globalList.appendChild(li);
    }
  }

  // ── public API ───────────────────────────────────────────────────────────
  // setLiveScore(frame) — feed a server SCORE frame { sessionId, endedAt, tallies }.
  // Always stores; re-renders LOCAL only when the panel is open on that tab.
  function setLiveScore(frame) {
    const f = frame || {};
    liveInputs = {
      current: talliesToCurrentEvents(f.tallies, f.sessionId, f.endedAt),
      history: [],
    };
    if (open && activeTab === 'local') _renderLocal();
  }

  async function refreshGlobal() {
    const seq = ++globalSeq;
    globalStatus = 'loading';
    if (open && activeTab === 'global') _renderGlobal();
    let res;
    try { res = await fetchGlobal(); }
    catch { res = { ok: false, offline: true, rows: [] }; }
    if (seq !== globalSeq) return; // a newer refresh superseded this one
    const rows = res && Array.isArray(res.rows) ? res.rows : [];
    if (res && res.ok) {
      globalRows = rows;               // fresh data replaces the cache
      globalStatus = rows.length ? 'ok' : 'empty';
    } else {
      // Offline/failed: keep the cached rows, just flag the state.
      globalStatus = 'offline';
    }
    if (open && activeTab === 'global') _renderGlobal();
  }

  function setTab(tab) {
    activeTab = tab === 'global' ? 'global' : 'local';
    _renderTabs();
    if (activeTab === 'local') _renderLocal();
    else { _renderGlobal(); refreshGlobal(); }
  }

  function show() {
    if (open) return;
    open = true;
    root.style.display = '';
    _renderPublish();
    if (activeTab === 'local') _renderLocal();
    else { _renderGlobal(); refreshGlobal(); }
  }

  function hide() {
    if (!open) return;
    open = false;
    root.style.display = 'none';
  }

  function toggle() { if (open) hide(); else show(); }
  function isOpen() { return open; }

  function destroy() {
    globalSeq++; // invalidate any in-flight refresh
    try { localPanel.destroy(); } catch { /* noop */ }
    if (root.parentNode) root.parentNode.removeChild(root);
    open = false;
  }

  return { root, show, hide, toggle, isOpen, setTab, setLiveScore, refreshGlobal, destroy };
}
