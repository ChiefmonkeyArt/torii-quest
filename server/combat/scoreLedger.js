// server/combat/scoreLedger.js
// MP-3 (v0.2.366-alpha) — per-peer authoritative score accumulator.
// Pure: no wire, no timers, no side effects. Exercised by hitResolver + arena-ws.
//
// Design:
//   - Keyed by internal peer id (assigned at JOIN, matches sessions map).
//   - npub is captured once at first register(); becomes immutable.
//   - kills/deaths incremented on server-issued KILL events.
//   - damage accumulated on server-issued HIT events (any zone).
//   - snapshot() returns a wire-safe tally array for the SCORE frame.
//   - drop(id) removes a peer completely (hard delete).
//   - retire(id) marks a peer as disconnected but KEEPS its tally so the LOCAL
//     leaderboard lists everyone who played on this arena instance, including
//     players who have since left (v0.2.384-alpha). Rows persist until clear()
//     (server restart). A reconnecting npub resumes its tally via register().

/**
 * Create a fresh ledger.
 * @returns ledger API
 */
export function createScoreLedger() {
  /** @type {Map<string, { npub: string, kills: number, deaths: number, damage: number, retired: boolean }>} */
  const rows = new Map();

  function register(id, npub) {
    if (typeof id !== 'string' || id.length === 0)   throw new TypeError('id required');
    if (typeof npub !== 'string' || !/^[0-9a-f]{64}$/.test(npub)) {
      throw new TypeError('npub must be 64-hex');
    }
    if (!rows.has(id)) {
      // Reconnect: if a RETIRED row already exists for this npub (the same human
      // rejoining within the server session), re-key it onto the new peer id and
      // resume its tally, so we never double-count or lose their standing.
      let resumed = null;
      for (const [oldId, r] of rows) {
        if (r.retired && r.npub === npub) { resumed = r; rows.delete(oldId); break; }
      }
      rows.set(id, resumed
        ? { npub, kills: resumed.kills, deaths: resumed.deaths, damage: resumed.damage, retired: false }
        : { npub, kills: 0, deaths: 0, damage: 0, retired: false });
    }
    return rows.get(id);
  }

  function has(id) { return rows.has(id); }

  function addDamage(shooterId, amount) {
    const row = rows.get(shooterId);
    if (!row) return false;
    const n = Math.floor(amount);
    if (!Number.isFinite(n) || n <= 0) return false;
    row.damage = Math.min(1e6, row.damage + n);
    return true;
  }

  function addKill(shooterId, victimId) {
    if (shooterId === victimId) return false; // no self-kill credit
    const s = rows.get(shooterId);
    const v = rows.get(victimId);
    if (!s || !v) return false;
    s.kills  = Math.min(1e6, s.kills  + 1);
    v.deaths = Math.min(1e6, v.deaths + 1);
    return true;
  }

  function get(id) {
    const r = rows.get(id);
    if (!r) return null;
    return { id, npub: r.npub, kills: r.kills, deaths: r.deaths, damage: r.damage };
  }

  // snapshot(limit?) — wire-safe tally rows, sorted (kills desc, damage desc,
  // id asc). Includes retired (disconnected) peers. When `limit` is a positive
  // integer, only the top N rows are returned (the SCORE wire frame caps at 32).
  function snapshot(limit) {
    const out = [];
    for (const [id, r] of rows) {
      out.push({ id, npub: r.npub, kills: r.kills, deaths: r.deaths, damage: r.damage });
    }
    // Deterministic order — sort by (kills desc, damage desc, id asc)
    out.sort((a, b) => (b.kills - a.kills) || (b.damage - a.damage) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (Number.isInteger(limit) && limit > 0 && out.length > limit) return out.slice(0, limit);
    return out;
  }

  function drop(id) {
    return rows.delete(id);
  }

  // retire(id) — the peer disconnected but its tally stays on the LOCAL board.
  function retire(id) {
    const r = rows.get(id);
    if (!r) return false;
    r.retired = true;
    return true;
  }

  function size() { return rows.size; }

  function clear() { rows.clear(); }

  return { register, has, addDamage, addKill, get, snapshot, drop, retire, size, clear };
}

/**
 * Generate a 16-hex-char session id (arena instance lifetime).
 * Uses randomBytes when available (server), else Math.random for tests.
 * @param {(n:number)=>Uint8Array} [randomFn]
 */
export function newSessionId(randomFn) {
  if (typeof randomFn === 'function') {
    const b = randomFn(8);
    let s = '';
    for (let i = 0; i < 8; i++) s += b[i].toString(16).padStart(2, '0');
    return s;
  }
  // Test / fallback path.
  let s = '';
  for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}
