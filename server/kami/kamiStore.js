// kamiStore.js — ADR-0025. On-disk store for Kami Mode ema on the operator's VPS.
//
// Ema are SEALED IN THE BROWSER before they arrive. This module only ever holds
// ciphertext: it cannot read a note, and it holds no private key. Two stores,
// because the owner's cull rule is asymmetric:
//
//   ema.jsonl        — one sealed ema record per line, APPEND-ONLY, forever.
//                      Text and state survive until the owner clears them
//                      manually. (Owner: "I don't think I need them to hang too
//                      long" — that is an explicit future cull, not a ring.)
//   shots/<id>.bin   — one sealed screenshot envelope per file. Ring-buffered
//                      to SCREENSHOT_KEEP (420): when the count exceeds the cap
//                      the OLDEST files are deleted. (Owner: "default to on,
//                      then cull anything after 420".)
//
// Splitting the two is what makes the rule expressible: the screenshot is the
// only bulky part, and culling it must NOT cost the note. If text and image were
// one sealed blob, the server could not see which is which and would have to
// cull whole ema (losing notes) or keep everything (unbounded disk).
//
// This module is storage-shaped only — no HTTP, no auth. Those live in
// arena-ws.js, which calls into here after adminFromRequest succeeds.

import path from 'path';

const SCREENSHOT_KEEP_DEFAULT = 420;

/**
 * Build a kami store bound to a directory.
 *
 * @param {object} opts
 *   dir     {string}            absolute directory for ema.jsonl + shots/
 *   fs      {object}             a node:fs/promises-compatible API (injectable)
 *   keep    {number}            shot ring-buffer cap (default 420)
 */
export function createKamiStore({ dir, fs, keep = SCREENSHOT_KEEP_DEFAULT }) {
  const f = fs;
  if (!f || typeof f.appendFile !== 'function') {
    throw new Error('kamiStore: fs (node:fs/promises API) is required');
  }
  const shotsDir = path.join(dir, 'shots');
  const emaPath = path.join(dir, 'ema.jsonl');

  async function ensure() {
    await f.mkdir(dir, { recursive: true });
    await f.mkdir(shotsDir, { recursive: true });
  }

  /** Append one sealed ema record (the JSON line is the caller's to shape). */
  async function appendEma(jsonLine) {
    await ensure();
    await f.appendFile(emaPath, jsonLine + '\n');
  }

  /** Write one sealed shot envelope. Returns the path written. */
  async function writeShot(id, envJson) {
    await ensure();
    const p = path.join(shotsDir, `${id}.bin`);
    await f.writeFile(p, envJson);
    return p;
  }

  /** Cull the shots ring buffer down to `keep` by deleting oldest-mtime files.
   *  Returns the filenames removed (empty if under cap). */
  async function cullShots() {
    await ensure();
    let files;
    try { files = await f.readdir(shotsDir); } catch { return []; }
    if (files.length <= keep) return [];
    const statted = await Promise.all(files.map(async (n) => {
      const p = path.join(shotsDir, n);
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

  /** Count shots on disk (diagnostic). */
  async function shotCount() {
    try {
      const files = await f.readdir(shotsDir);
      return files.length;
    } catch { return 0; }
  }

  return { ensure, appendEma, writeShot, cullShots, shotCount, dir, shotsDir, emaPath, keep };
}

/** Shape one JSONL line for ema.jsonl. Stable field order for greppability. */
export function emaLine({ id, ts, requester, sealedEma }) {
  return JSON.stringify({ id, ts, requester, sealed: sealedEma });
}

export { SCREENSHOT_KEEP_DEFAULT };
