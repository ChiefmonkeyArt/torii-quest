// playerStats.js — left-panel stats display (sats, kills, runs, accuracy donut).
// Persists lifetime totals per Nostr pubkey in localStorage. Updates on
// NOSTR_LOGIN (initial pull) and HUD_UPDATE (live in-run reflection).
import { state } from './state.js';
import { on, EV } from './events.js';
import { pickSelfRow } from './engine/multiplayer/scoreReporter.js';

const LS_PREFIX = 'tq:stats:';   // per-pubkey lifetime stats key prefix

// v0.2.384-alpha: the server-authoritative self tally from the latest SCORE
// frame (MP only). When present it is the SAME source the LOCAL leaderboard
// uses, so the KILLS shown here match the board exactly (no drifting local
// counter). Null in single-player / before any SCORE frame → the local
// lifetime+run fallback below is used unchanged.
let _authSelf = null;

// DOM refs (resolved lazily — index.html may not be ready at import time)
let _el = null;
function _dom() {
  if (_el) return _el;
  _el = {
    sats:        document.getElementById('big-sats'),
    kills:       document.getElementById('big-kills'),
    runs:        document.getElementById('big-runs'),
    donutPct:    document.getElementById('donut-pct'),
    donutHits:   document.getElementById('donut-hits-arc'),
    donutGot:    document.getElementById('donut-got-arc'),
    legendHits:  document.getElementById('legend-hits'),
    legendGot:   document.getElementById('legend-gothit'),
    legendKills: document.getElementById('legend-kills'),
    statusSub:   document.getElementById('stats-status-sub'),
  };
  return _el;
}

// ── Lifetime stats storage ───────────────────────────────────────────────────
function _loadLifetime(pubkey) {
  if (!pubkey) return { kills: 0, runs: 0, hits: 0, gothit: 0, shots: 0 };
  try {
    const raw = localStorage.getItem(LS_PREFIX + pubkey);
    if (!raw) return { kills: 0, runs: 0, hits: 0, gothit: 0, shots: 0 };
    const v = JSON.parse(raw);
    return {
      kills:  v.kills  | 0,
      runs:   v.runs   | 0,
      hits:   v.hits   | 0,
      gothit: v.gothit | 0,
      shots:  v.shots  | 0,
    };
  } catch (_) {
    return { kills: 0, runs: 0, hits: 0, gothit: 0, shots: 0 };
  }
}

export function saveLifetime(stats) {
  const pk = state.nostrPubkey;
  if (!pk) return;
  try { localStorage.setItem(LS_PREFIX + pk, JSON.stringify(stats)); } catch (_) {}
}

// ── Rendering ────────────────────────────────────────────────────────────────
function _renderFrom(lt) {
  const d = _dom();
  // KILLS: prefer the server-authoritative session tally (MP) so it matches the
  // leaderboard; fall back to lifetime + current run when there is no SCORE
  // frame (single-player / pre-connect).
  const liveKills = _authSelf ? (_authSelf.kills | 0) : ((lt.kills | 0) + (state.kills | 0));
  if (d.sats)  d.sats.textContent  = String(state.sats | 0);
  if (d.kills) d.kills.textContent = String(liveKills);
  if (d.runs)  d.runs.textContent  = String(lt.runs | 0);

  const hitsLanded = (lt.hits   | 0) + (state.hits | 0);
  const timesHit   = (lt.gothit | 0);
  const shots      = (lt.shots  | 0);
  const pct = shots > 0 ? Math.round((hitsLanded / shots) * 100) : 0;

  if (d.donutPct)    d.donutPct.textContent    = pct + '%';
  if (d.legendHits)  d.legendHits.textContent  = String(hitsLanded);
  if (d.legendGot)   d.legendGot.textContent   = String(timesHit);
  if (d.legendKills) d.legendKills.textContent = String(liveKills);

  // Donut arc: circumference @ r=14 ≈ 88. Two arcs share it visually.
  if (d.donutHits && d.donutGot) {
    const C = 88;
    const hitsArc = Math.min(C, (pct / 100) * C);
    const gotArc  = shots > 0 ? Math.min(C - hitsArc, (timesHit / Math.max(1, hitsLanded + timesHit)) * C * 0.5) : 0;
    d.donutHits.setAttribute('stroke-dasharray', `${hitsArc} ${C}`);
    d.donutGot .setAttribute('stroke-dasharray', `${gotArc} ${C}`);
    d.donutGot .setAttribute('stroke-dashoffset', `-${hitsArc}`);
  }

  if (d.statusSub) d.statusSub.style.display = 'none';
}

// ── Init ─────────────────────────────────────────────────────────────────────
let _currentLifetime = { kills: 0, runs: 0, hits: 0, gothit: 0, shots: 0 };

export function initPlayerStats() {
  // On login (initial pubkey OR profile-meta refresh) — populate from storage.
  on(EV.NOSTR_LOGIN, ({ pubkey }) => {
    _currentLifetime = _loadLifetime(pubkey);
    _renderFrom(_currentLifetime);
  });

  // Live updates from HUD ticks reflect kills/hits gained mid-run.
  on(EV.HUD_UPDATE, () => {
    if (state.nostrPubkey) _renderFrom(_currentLifetime);
  });

  // v0.2.384-alpha: server-authoritative SCORE frame (MP). Adopt our own tally
  // row as the source of truth for KILLS, then re-render so the panel matches
  // the leaderboard for this arena instance.
  on(EV.SCORE_FRAME, (frame) => {
    const tallies = frame && Array.isArray(frame.tallies) ? frame.tallies : [];
    _authSelf = pickSelfRow(tallies, { selfPubkey: state.nostrPubkey || null });
    _renderFrom(_currentLifetime);
  });
}

export function getLifetime() { return { ..._currentLifetime }; }
