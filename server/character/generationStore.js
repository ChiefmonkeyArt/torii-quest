// server/character/generationStore.js — durable job store for paid character
// generation (audit F02). Replaces the transient in-memory pendingGenerations Map
// with a bounded state machine that survives restarts and can never strand or
// double-charge a payer.
//
// States: pending → claimed → completed | retryable
//   pending    invoice minted, settlement not yet verified. Bounded + volume-capped;
//              swept past a TTL. This is the ONLY state that can be evicted/swept —
//              a pending entry has cost the operator nothing yet.
//   claimed    settlement verified, generation about to run / running. Entered only
//              via an atomic compare-and-set (pending → claimed, or retryable → claimed).
//   completed  generation succeeded; cached glbUrl for an idempotent re-confirm.
//   retryable  generation failed AFTER settlement. The settled invoice is retained so
//              the payer can re-confirm (re-verify the already-settled invoice, no
//              re-charge) and re-enter claimed without paying again.
//
// Durability: a single JSON snapshot written atomically (write .tmp, then rename).
// All methods are synchronous so the claim CAS cannot interleave in the event loop;
// the snapshot is a tiny bounded object, so the synchronous write cost is negligible.
//
// The fs is injectable (default node:fs) so tests can use a fake in-memory fs; the
// default surface is the small synchronous subset this module actually uses.

import nodeFs from 'node:fs';

export const GEN_STATES = Object.freeze({
  PENDING: 'pending',
  CLAIMED: 'claimed',
  COMPLETED: 'completed',
  RETRYABLE: 'retryable',
});

const DEFAULT_PENDING_TTL_MS = 15 * 60 * 1000;      // unclaimed invoice lifetime
const DEFAULT_SETTLED_TTL_MS = 24 * 60 * 60 * 1000; // paid (completed/retryable) retention
const DEFAULT_MAX_PENDING = 512;

function requiredFs(fs) {
  const ok =
    fs &&
    typeof fs.readFileSync === 'function' &&
    typeof fs.writeFileSync === 'function' &&
    typeof fs.renameSync === 'function' &&
    typeof fs.existsSync === 'function' &&
    typeof fs.mkdirSync === 'function';
  if (!ok) {
    throw new Error('generationStore: fs must expose readFileSync/writeFileSync/renameSync/existsSync/mkdirSync');
  }
  return fs;
}

/**
 * Build a durable generation store bound to a JSON snapshot file.
 * @param {object} opts { filePath, fs, pendingTtlMs, settledTtlMs, maxPending }
 * @returns store API (all synchronous)
 */
export function makeGenerationStore({
  filePath,
  fs = nodeFs,
  pendingTtlMs = DEFAULT_PENDING_TTL_MS,
  settledTtlMs = DEFAULT_SETTLED_TTL_MS,
  maxPending = DEFAULT_MAX_PENDING,
} = {}) {
  if (!filePath) throw new Error('generationStore: filePath is required');
  const f = requiredFs(fs);
  const records = new Map(); // generationId -> record

  function persist() {
    // Atomic snapshot: write a sibling .tmp then rename over the real path, so a
    // crash never leaves a half-written file (the old snapshot stays intact).
    const obj = {};
    for (const [id, rec] of records) obj[id] = rec;
    const tmp = `${filePath}.tmp`;
    f.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
    f.renameSync(tmp, filePath);
  }

  function load() {
    if (!f.existsSync(filePath)) return;
    let raw;
    try {
      raw = f.readFileSync(filePath, 'utf8');
    } catch {
      return; // unreadable snapshot: start empty rather than crash the server
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // corrupt snapshot: start empty
    }
    if (!parsed || typeof parsed !== 'object') return;
    for (const [id, rec] of Object.entries(parsed)) {
      if (!rec || typeof rec.state !== 'string') continue;
      records.set(id, rec);
    }
  }

  function isExpired(rec, now) {
    if (rec.state === GEN_STATES.PENDING) {
      return typeof rec.expiresAt === 'number' && now > rec.expiresAt;
    }
    // Paid states are retained for a generous window, keyed on when settlement
    // was first confirmed, so a completed/retryable entry is never dropped while
    // a payer could reasonably re-confirm.
    if (typeof rec.settledAt === 'number') {
      return now > rec.settledAt + settledTtlMs;
    }
    return false;
  }

  function create({ generationId, prompt, invoice, verifyUrl, pubkey }) {
    if (!generationId || records.has(generationId)) return false;
    // Bound the store by evicting ONLY unclaimed pending entries, oldest first —
    // never a paid (claimed/retryable/completed) one.
    let pendingIds = [];
    for (const [id, rec] of records) if (rec.state === GEN_STATES.PENDING) pendingIds.push(id);
    while (pendingIds.length >= maxPending) {
      const oldest = pendingIds.shift();
      if (oldest != null) records.delete(oldest);
    }
    records.set(generationId, {
      generationId,
      prompt,
      invoice,
      verifyUrl: verifyUrl || null,
      pubkey,
      state: GEN_STATES.PENDING,
      expiresAt: Date.now() + pendingTtlMs,
      settledAt: null,
      glbUrl: null,
      error: null,
      createdAt: Date.now(),
    });
    persist();
    return true;
  }

  function get(generationId) {
    return records.get(generationId) || null;
  }

  /**
   * Atomic compare-and-set into the claimed state. Returns the record on success,
   * null if the entry is missing or not in a claimable state (already claimed /
   * completed / in-flight). Accepts pending (first confirm) and retryable (re-confirm
   * after a failed generation — no re-charge) as claimable, nothing else.
   */
  function claim(generationId) {
    const rec = records.get(generationId);
    if (!rec) return null;
    if (rec.state !== GEN_STATES.PENDING && rec.state !== GEN_STATES.RETRYABLE) return null;
    rec.state = GEN_STATES.CLAIMED;
    if (rec.settledAt == null) rec.settledAt = Date.now();
    persist();
    return rec;
  }

  function complete(generationId, glbUrl) {
    const rec = records.get(generationId);
    if (!rec || rec.state !== GEN_STATES.CLAIMED) return false;
    rec.state = GEN_STATES.COMPLETED;
    rec.glbUrl = glbUrl;
    rec.error = null;
    persist();
    return true;
  }

  function fail(generationId, error) {
    const rec = records.get(generationId);
    if (!rec || rec.state !== GEN_STATES.CLAIMED) return false;
    rec.state = GEN_STATES.RETRYABLE;
    rec.error = error ? String(error) : 'generation failed';
    persist();
    return true;
  }

  function sweep(now = Date.now()) {
    let removed = 0;
    for (const [id, rec] of records) {
      if (isExpired(rec, now)) {
        records.delete(id);
        removed++;
      }
    }
    if (removed > 0) persist();
    return removed;
  }

  function size() {
    return records.size;
  }

  load();

  return { create, get, claim, complete, fail, sweep, size };
}