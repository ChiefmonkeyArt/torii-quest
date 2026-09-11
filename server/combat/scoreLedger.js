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

// Deterministic rank: kills desc, damage desc, id asc. Ids are unique so this is
// a total order (no true ties) — the top-k is always well-defined.
function rankCmp(a, b) {
  return (b.kills - a.kills) || (b.damage - a.damage)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

// The k highest-ranked items (by cmp), themselves sorted. O(n log k) time and
// O(k) memory via a bounded min-heap, instead of materializing + fully sorting
// every row (O(n log n)). A falsy k delegates to a plain full sort.
function selectTop(items, cmp, k) {
  if (!k) {
    const all = Array.from(items);
    all.sort(cmp);
    return all;
  }
  const worse = (x, y) => cmp(x, y) > 0; // x ranks after y ⇒ x is "worse"
  const heap = []; // min-heap by `worse`: root is the worst kept candidate
  const siftUp = (i) => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (worse(heap[i], heap[p])) { [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
      else break;
    }
  };
  const siftDown = (i) => {
    const n = heap.length;
    for (;;) {
      const l = i * 2 + 1;
      if (l >= n) break;
      let c = l;
      const r = l + 1;
      if (r < n && worse(heap[r], heap[l])) c = r;
      if (worse(heap[c], heap[i])) { [heap[i], heap[c]] = [heap[c], heap[i]]; i = c; }
      else break;
    }
  };
  for (const item of items) {
    if (heap.length < k) { heap.push(item); siftUp(heap.length - 1); }
    else if (cmp(item, heap[0]) < 0) { heap[0] = item; siftDown(0); }
  }
  heap.sort(cmp);
  return heap;
}

/**
 * Create a fresh ledger.
 * @returns ledger API
 */
export function createScoreLedger() {
  /** @type {Map<string, { npub: string, kills: number, deaths: number, damage: number, retired: boolean }>} */
  const rows = new Map();
  // O(1) lookup of the retired id for an npub, so reconnect resume doesn't have
  // to linearly scan every row (which grows without bound over an arena session).
  // Invariant: at most one retired row per npub (npub is captured once and is
  // immutable), matching the documented reconnect contract.
  const retiredByNpub = new Map();

  function register(id, npub) {
    if (typeof id !== 'string' || id.length === 0)   throw new TypeError('id required');
    if (typeof npub !== 'string' || !/^[0-9a-f]{64}$/.test(npub)) {
      throw new TypeError('npub must be 64-hex');
    }
    if (!rows.has(id)) {
      // Reconnect: if a RETIRED row exists for this npub (the same human rejoining
      // within the server session), re-key it onto the new peer id and resume its
      // tally so we never double-count or lose their standing. The npub→id index
      // makes this O(1) instead of scanning every retained row.
      const oldId = retiredByNpub.get(npub);
      const resumed = oldId === undefined ? null : rows.get(oldId);
      if (resumed && resumed.retired && resumed.npub === npub) {
        rows.delete(oldId);
        retiredByNpub.delete(npub);
        rows.set(id, { npub, kills: resumed.kills, deaths: resumed.deaths, damage: resumed.damage, retired: false });
      } else {
        rows.set(id, { npub, kills: 0, deaths: 0, damage: 0, retired: false });
      }
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

  // Bot combat has only one player-side row. Keep its kill/death counters in the
  // same authoritative ledger without inventing synthetic bot identities.
  function addBotKill(shooterId) {
    const row = rows.get(shooterId);
    if (!row) return false;
    row.kills = Math.min(1e6, row.kills + 1);
    return true;
  }

  function addBotDeath(victimId) {
    const row = rows.get(victimId);
    if (!row) return false;
    row.deaths = Math.min(1e6, row.deaths + 1);
    return true;
  }

  function get(id) {
    const r = rows.get(id);
    if (!r) return null;
    return { id, npub: r.npub, kills: r.kills, deaths: r.deaths, damage: r.damage };
  }

  // snapshot(limit?) — wire-safe tally rows, sorted (kills desc, damage desc,
  // id asc). Includes retired (disconnected) peers. When `limit` is a positive
  // integer, only the top N rows are returned via bounded top-k selection (the
  // SCORE wire frame caps at 32), so it never sorts the whole retained ledger.
  function snapshot(limit) {
    const k = Number.isInteger(limit) && limit > 0 ? limit : 0;
    const items = [];
    for (const [id, r] of rows) {
      items.push({ id, npub: r.npub, kills: r.kills, deaths: r.deaths, damage: r.damage });
    }
    return selectTop(items, rankCmp, k);
  }

  function drop(id) {
    const r = rows.get(id);
    const removed = rows.delete(id);
    // Keep the index from pointing at a dropped retired row.
    if (r && retiredByNpub.get(r.npub) === id) retiredByNpub.delete(r.npub);
    return removed;
  }

  // retire(id) — the peer disconnected but its tally stays on the LOCAL board.
  function retire(id) {
    const r = rows.get(id);
    if (!r) return false;
    r.retired = true;
    retiredByNpub.set(r.npub, id);
    return true;
  }

  function size() { return rows.size; }

  function clear() {
    rows.clear();
    retiredByNpub.clear();
  }

  return {
    register, has, addDamage, addKill, addBotKill, addBotDeath,
    get, snapshot, drop, retire, size, clear,
  };
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
