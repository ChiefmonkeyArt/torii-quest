// server/kami/kamiAutoStore.js — ADR-0055. On-disk ring for auto-capture frames.
//
// SEPARATE from kamiStore.js: the auto-capture ring has its own directory
// (/var/lib/torii-quest/kami/autocap) and its own cap (120), so it can NEVER
// evict a real manual ema screenshot from shots/ (cap 420) and never appends to
// ema.jsonl (append-only forever). The server holds ciphertext only — it never
// reads a frame or snapshot and holds no private key.
//
// TRUE RING: each frame is ONE file autocap/<id>.json containing {ema, shot},
// ring-culled to `keep` by oldest-mtime. There is NO append-only index — the
// ring dir IS the store, so disk usage is strictly bounded (~120 files). A
// separate forever-appending jsonl would grow unbounded at 1Hz; this does not.
//
// Storage-shaped only (no HTTP, no auth) — the route handler in arena-ws.js calls
// into here after adminFromRequest succeeds, exactly like storeKamiBatch.

import path from 'path';

export const AUTOCAP_KEEP_DEFAULT = 120;

/**
 * Build an auto-capture ring store bound to a directory.
 *
 * @param {object} opts
 *   dir   {string}  absolute directory for the autocap/<id>.json ring
 *   fs    {object}  a node:fs/promises-compatible API (injectable)
 *   keep  {number}  ring cap (default 120)
 */
export function createAutoCapStore({ dir, fs, keep = AUTOCAP_KEEP_DEFAULT }) {
  const f = fs;
  if (!f || typeof f.writeFile !== 'function') {
    throw new Error('kamiAutoStore: fs (node:fs/promises API) is required');
  }
  const ringDir = path.join(dir, 'autocap');

  async function ensure() {
    await f.mkdir(dir, { recursive: true });
    await f.mkdir(ringDir, { recursive: true });
  }

  /** Write one frame record ({ema, shot}) as a single JSON file. Returns the path. */
  async function writeFrame(id, recordJson) {
    await ensure();
    const p = path.join(ringDir, `${id}.json`);
    await f.writeFile(p, recordJson);
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

  return { ensure, writeFrame, cullFrames, frameCount, dir, ringDir, keep };
}
