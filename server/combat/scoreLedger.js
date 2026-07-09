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
//   - drop(id) removes a peer on disconnect. History is not preserved
//     server-side (Nostr relays are the durable store).

/**
 * Create a fresh ledger.
 * @returns ledger API
 */
export function createScoreLedger() {
  /** @type {Map<string, { npub: string, kills: number, deaths: number, damage: number }>} */
  const rows = new Map();

  function register(id, npub) {
    if (typeof id !== 'string' || id.length === 0)   throw new TypeError('id required');
    if (typeof npub !== 'string' || !/^[0-9a-f]{64}$/.test(npub)) {
      throw new TypeError('npub must be 64-hex');
    }
    if (!rows.has(id)) {
      rows.set(id, { npub, kills: 0, deaths: 0, damage: 0 });
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

  function snapshot() {
    const out = [];
    for (const [id, r] of rows) {
      out.push({ id, npub: r.npub, kills: r.kills, deaths: r.deaths, damage: r.damage });
    }
    // Deterministic order — sort by (kills desc, damage desc, id asc)
    out.sort((a, b) => (b.kills - a.kills) || (b.damage - a.damage) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return out;
  }

  function drop(id) {
    return rows.delete(id);
  }

  function size() { return rows.size; }

  function clear() { rows.clear(); }

  return { register, has, addDamage, addKill, get, snapshot, drop, size, clear };
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
