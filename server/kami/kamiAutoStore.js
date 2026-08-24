// server/kami/kamiAutoStore.js — ADR-0055. On-disk ring for auto-capture frames.
//
// SEPARATE from kamiStore.js: the auto-capture ring has its own directory
// (/var/lib/torii-quest/kami/autocap) and its own cap (120), so it can NEVER
// evict a real manual ema screenshot from shots/ (cap 420) and never appends to
// ema.jsonl (append-only forever). The server holds ciphertext only — it never
// reads a frame or snapshot and holds no private key.
//
// Storage-shaped only (no HTTP, no auth) — the route handler in arena-ws.js calls
// into here after adminFromRequest succeeds, exactly like storeKamiBatch.

import path from 'path';

export const AUTOCAP_KEEP_DEFAULT = 120;

/**
 * Build an auto-capture ring store bound to a directory.
 *
 * @param {object} opts
 *   dir   {string}  absolute directory for autocap.jsonl + autocap/<id>.bin
 *   fs    {object}  a node:fs/promises-compatible API (injectable)
 *   keep  {number}  ring cap (default 120)
 */
export function createAutoCapStore({ dir, fs, keep = AUTOCAP_KEEP_DEFAULT }) {
  const f = fs;
  if (!f || typeof f.writeFile !== 'function') {
    throw new Error('kamiAutoStore: fs (node:fs/promises API) is required');
  }
  const ringDir = path.join(dir, 'autocap');
  const indexPath = path.join(dir, 'autocap.jsonl');

  async function ensure() {
    await f.mkdir(dir, { recursive: true });
    await f.mkdir(ringDir, { recursive: true });
  }

  /** Append one sealed index line to autocap.jsonl (append-only, the cull target
   *  is the ring files, not the index — the index is bounded by the ring cap via
   *  cullIndex below). */
  async function appendIndex(jsonLine) {
    await ensure();
    await f.appendFile(indexPath, jsonLine + '\n');
  }

  /** Write one sealed frame envelope to the ring. Returns the path written. */
  async function writeFrame(id, envJson) {
    await ensure();
    const p = path.join(ringDir, `${id}.bin`);
    await f.writeFile(p, envJson);
    return p;
  }

  /** Cull the ring down to `keep` by deleting oldest-mtime files. Returns removed. */
  async function cullFrames() {
    await ensure();
    let files;
    try { files = await f.readdir(ringDir); } catch { return []; }
    if (files.length <= keep) return [];
    const statted = await Promise.all(files.map(async (n) => {
      const p = path.join(ringDir, n);
      try {
        const st = await f.stat(p);
        return { n, p, mtime: st.mtimeMs };
      } catch {
        return null; // file vanished between readdir and stat — skip it
      }
    }));
    const live = statted.filter(Boolean).sort((a, b) => a.mtime - b.mtime);
    const removeCount = live.length - keep;
    const removed = [];
    for (const s of live.slice(0, removeCount)) {
      try { await f.unlink(s.p); removed.push(s.n); } catch { /* already gone */ }
    }
    return removed;
  }

  /** Count frames on disk (diagnostic). */
  async function frameCount() {
    try {
      const files = await f.readdir(ringDir);
      return files.length;
    } catch { return 0; }
  }

  return { ensure, appendIndex, writeFrame, cullFrames, frameCount, dir, ringDir, indexPath, keep };
}

/** Shape one JSONL line for autocap.jsonl. Stable field order for greppability. */
export function autoCapLine({ id, ts, requester, sealedEma, shotId }) {
  return JSON.stringify({
    id,
    ts,
    requester,
    sealedEma,
    shotId: shotId || null,
  });
}

