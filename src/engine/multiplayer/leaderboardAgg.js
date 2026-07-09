// src/engine/multiplayer/leaderboardAgg.js
// MP-3 (v0.2.366-alpha) — pure leaderboard aggregator.
//
// Consumes:
//   • current[]  — kind:30078#d=torii-quest events (replaceable; one per pubkey)
//   • history[]  — kind:1 tagged t=torii-quest-score events (one per match)
//
// Emits:
//   [{ npub, currentKills, currentDeaths, currentDamage,
//      lifetimeKills, lifetimeDeaths, lifetimeDamage,
//      matches, lastSeen }, …]  sorted by (lifetimeKills desc, K/D desc, lastSeen desc)
//
// No I/O; safe to run in a Web Worker if the relay pool ever gets fat.
// SPDX-License-Identifier: MIT

const SESSION_HEX16 = /^[0-9a-f]{16}$/;

/**
 * @param {object} evt
 * @returns parsed row or null
 */
function parseEventBody(evt) {
  if (!evt || typeof evt.content !== 'string') return null;
  let body;
  try { body = JSON.parse(evt.content); } catch { return null; }
  if (!body || typeof body !== 'object') return null;
  const kills  = Number(body.kills);
  const deaths = Number(body.deaths);
  const damage = Number(body.damage);
  const endedAt   = Number(body.endedAt);
  const sessionId = body.sessionId;
  if (!Number.isInteger(kills)  || kills  < 0 || kills  > 1e6) return null;
  if (!Number.isInteger(deaths) || deaths < 0 || deaths > 1e6) return null;
  if (!Number.isInteger(damage) || damage < 0 || damage > 1e6) return null;
  if (!Number.isFinite(endedAt) || endedAt < 0)                return null;
  if (typeof sessionId !== 'string' || !SESSION_HEX16.test(sessionId)) return null;
  return { kills, deaths, damage, endedAt, sessionId };
}

/**
 * @param {{ current: any[], history: any[] }} inputs
 * @returns aggregate rows sorted for display
 */
export function aggregate(inputs) {
  const current = Array.isArray(inputs?.current) ? inputs.current : [];
  const history = Array.isArray(inputs?.history) ? inputs.history : [];

  /** @type {Map<string, { npub: string,
   *   currentKills: number, currentDeaths: number, currentDamage: number,
   *   lifetimeKills: number, lifetimeDeaths: number, lifetimeDamage: number,
   *   matches: number, lastSeen: number,
   *   sessions: Set<string> }>} */
  const rows = new Map();

  const upsert = (pubkey) => {
    let r = rows.get(pubkey);
    if (!r) {
      r = {
        npub: pubkey,
        currentKills: 0, currentDeaths: 0, currentDamage: 0,
        lifetimeKills: 0, lifetimeDeaths: 0, lifetimeDamage: 0,
        matches: 0, lastSeen: 0,
        sessions: new Set(),
      };
      rows.set(pubkey, r);
    }
    return r;
  };

  // Current snapshot (30078) — one per pubkey; if duplicates appear pick newest.
  const currentSeen = new Map();
  for (const evt of current) {
    if (!evt || typeof evt.pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(evt.pubkey)) continue;
    const parsed = parseEventBody(evt);
    if (!parsed) continue;
    const prev = currentSeen.get(evt.pubkey);
    if (!prev || Number(evt.created_at) > Number(prev.created_at)) {
      currentSeen.set(evt.pubkey, { ...evt, _parsed: parsed });
    }
  }
  for (const [pubkey, evt] of currentSeen) {
    const r = upsert(pubkey);
    r.currentKills  = evt._parsed.kills;
    r.currentDeaths = evt._parsed.deaths;
    r.currentDamage = evt._parsed.damage;
    r.lastSeen      = Math.max(r.lastSeen, Number(evt.created_at) || 0);
  }

  // Lifetime aggregate (kind:1) — deduplicate by (pubkey, sessionId).
  for (const evt of history) {
    if (!evt || typeof evt.pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(evt.pubkey)) continue;
    const parsed = parseEventBody(evt);
    if (!parsed) continue;
    const r = upsert(evt.pubkey);
    const sessKey = parsed.sessionId;
    if (r.sessions.has(sessKey)) continue; // dupe of same match
    r.sessions.add(sessKey);
    r.lifetimeKills  += parsed.kills;
    r.lifetimeDeaths += parsed.deaths;
    r.lifetimeDamage += parsed.damage;
    r.matches        += 1;
    r.lastSeen = Math.max(r.lastSeen, Number(evt.created_at) || 0);
  }

  // Fallback: if no kind:1 history seen for a pubkey, use current snapshot as
  // "lifetime" so new peers still appear on the leaderboard.
  for (const r of rows.values()) {
    if (r.matches === 0) {
      r.lifetimeKills  = r.currentKills;
      r.lifetimeDeaths = r.currentDeaths;
      r.lifetimeDamage = r.currentDamage;
    }
  }

  const out = Array.from(rows.values()).map((r) => ({
    npub: r.npub,
    currentKills: r.currentKills, currentDeaths: r.currentDeaths, currentDamage: r.currentDamage,
    lifetimeKills: r.lifetimeKills, lifetimeDeaths: r.lifetimeDeaths, lifetimeDamage: r.lifetimeDamage,
    matches: r.matches, lastSeen: r.lastSeen,
    kd: r.lifetimeDeaths > 0 ? r.lifetimeKills / r.lifetimeDeaths : r.lifetimeKills,
  }));

  out.sort((a, b) =>
    (b.lifetimeKills - a.lifetimeKills)
    || (b.kd - a.kd)
    || (b.lastSeen - a.lastSeen)
    || (a.npub < b.npub ? -1 : a.npub > b.npub ? 1 : 0));

  return out;
}

/** Convenience: top N rows. */
export function topN(inputs, n) {
  const all = aggregate(inputs);
  return all.slice(0, Math.max(0, n | 0));
}
