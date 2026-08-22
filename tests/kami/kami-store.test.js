// kami-store.test.js — ADR-0025. Tests for the on-disk ema store + route helpers.
//
// A tiny in-memory fs implements the node:fs/promises subset the store uses, so
// the cull/append logic is tested without touching disk. The route helpers
// (validateKamiBatch / storeKamiBatch) are pure and tested directly.

import { describe, it, expect } from 'vitest';
import { createKamiStore, emaLine } from '../../server/kami/kamiStore.js';
import { validateKamiBatch, storeKamiBatch } from '../../server/kami/kamiRoute.js';

// Minimal mem fs: dirs as Maps, files as strings, with mtimes for cull ordering.
function memFs() {
  const root = { type: 'dir', entries: new Map() };
  function nodeAt(parts, make = false) {
    let cur = root;
    for (const p of parts) {
      if (cur.type !== 'dir') throw new Error('not a dir');
      let next = cur.entries.get(p);
      if (!next) {
        if (!make) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        next = { type: 'dir', entries: new Map() };
        cur.entries.set(p, next);
      }
      cur = next;
    }
    return cur;
  }
  const files = new Map(); // path -> { content, mtime }
  return {
    async mkdir(p) { nodeAt(p.split('/').filter(Boolean), true); },
    async appendFile(p, s) {
      const ex = files.get(p);
      if (ex) { ex.content += s; ex.mtime = (ex.mtime || 0) + 1; }
      else files.set(p, { content: s, mtime: 1 });
    },
    async writeFile(p, content) { files.set(p, { content, mtime: Date.now() + files.size }); },
    async readdir(p) {
      const dir = nodeAt(p.split('/').filter(Boolean));
      // only file names directly under this dir
      const prefix = p + '/';
      const names = new Set();
      for (const fp of files.keys()) if (fp.startsWith(prefix)) names.add(fp.slice(prefix.length));
      return [...names];
    },
    async stat(p) {
      const f = files.get(p);
      if (!f) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return { mtimeMs: f.mtime };
    },
    async unlink(p) { files.delete(p); },
    _files: files,
  };
}

function makeStore(keep = 420) {
  const fs = memFs();
  const store = createKamiStore({ dir: '/k', fs, keep });
  return { store, fs };
}

describe('kamiStore', () => {
  it('appendEma writes one JSON line per ema, forever', async () => {
    const { store, fs } = makeStore();
    await store.appendEma(emaLine({ id: 'a', ts: 1, requester: 'r', sealedEma: { x: 1 } }));
    await store.appendEma(emaLine({ id: 'b', ts: 2, requester: 'r', sealedEma: { x: 2 } }));
    const lines = fs._files.get('/k/ema.jsonl').content.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).id).toBe('a');
    expect(JSON.parse(lines[1]).id).toBe('b');
  });

  it('writeShot writes a shots/<id>.bin file', async () => {
    const { store, fs } = makeStore();
    await store.writeShot('a', '{"env":1}');
    expect(fs._files.has('/k/shots/a.bin')).toBe(true);
    expect(fs._files.get('/k/shots/a.bin').content).toBe('{"env":1}');
  });

  it('cullShots is a no-op under the cap', async () => {
    const { store } = makeStore(5);
    for (let i = 0; i < 3; i++) await store.writeShot(`s${i}`, '{}');
    const removed = await store.cullShots();
    expect(removed).toEqual([]);
    expect(await store.shotCount()).toBe(3);
  });

  it('cullShots deletes oldest files down to the cap', async () => {
    const { store, fs } = makeStore(3);
    for (let i = 0; i < 5; i++) {
      await store.writeShot(`s${i}`, '{}');
      // bump mtime so order is deterministic (writeFile sets a unique mtime)
    }
    const removed = await store.cullShots();
    expect(removed).toHaveLength(2); // 5 - 3
    expect(await store.shotCount()).toBe(3);
    // oldest two (s0, s1) removed, newest three (s2,s3,s4) kept
    expect(fs._files.has('/k/shots/s0.bin')).toBe(false);
    expect(fs._files.has('/k/shots/s1.bin')).toBe(false);
    expect(fs._files.has('/k/shots/s4.bin')).toBe(true);
  });

  it('cullShots keeps exactly the cap when over by one', async () => {
    const { store } = makeStore(2);
    for (let i = 0; i < 3; i++) await store.writeShot(`s${i}`, '{}');
    await store.cullShots();
    expect(await store.shotCount()).toBe(2);
  });
});

describe('validateKamiBatch', () => {
  it('accepts a well-formed batch', () => {
    const batch = validateKamiBatch({ v: 1, batch: [
      { id: 'a', ema: { ct: 'x' }, shot: { env: { ct: 'y' } } },
      { id: 'b', ema: { ct: 'z' } },
    ] });
    expect(batch).not.toBeNull();
    expect(batch).toHaveLength(2);
    expect(batch[0].shot).toBeTruthy();
    expect(batch[1].shot).toBeNull();
  });

  it('rejects wrong version', () => {
    expect(validateKamiBatch({ v: 2, batch: [{ id: 'a', ema: {} }] })).toBeNull();
  });

  it('rejects missing/empty/oversized batch', () => {
    expect(validateKamiBatch({ v: 1, batch: [] })).toBeNull();
    expect(validateKamiBatch({ v: 1 })).toBeNull();
    expect(validateKamiBatch({ v: 1, batch: Array(65).fill({ id: 'a', ema: {} }) })).toBeNull();
  });

  it('skips malformed entries but keeps the rest', () => {
    const batch = validateKamiBatch({ v: 1, batch: [
      { id: 'a', ema: {} },            // ok
      { id: 'b' },                     // missing ema -> skipped
      { ema: {} },                     // missing id -> skipped
      { id: 'c', ema: { ct: 1 } },     // ok
    ] });
    expect(batch).toHaveLength(2);
    expect(batch.map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('returns null if every entry is malformed', () => {
    expect(validateKamiBatch({ v: 1, batch: [{ id: 'a' }, { ema: {} }] })).toBeNull();
  });
});

describe('storeKamiBatch', () => {
  it('appends ema, writes shots, and reports counts', async () => {
    const { store, fs } = makeStore(420);
    const batch = [
      { id: 'a', sealedEma: { ct: '1' }, shot: { env: { ct: 's1' } } },
      { id: 'b', sealedEma: { ct: '2' }, shot: null },
    ];
    const res = await storeKamiBatch(batch, 'adminpub', store);
    expect(res).toEqual({ stored: 2, shots: 1, culled: 0 });
    expect(fs._files.has('/k/ema.jsonl')).toBe(true);
    expect(fs._files.has('/k/shots/a.bin')).toBe(true);
    expect(fs._files.has('/k/shots/b.bin')).toBe(false);
  });

  it('culls shots when the batch pushes over the cap', async () => {
    const { store } = makeStore(2);
    await store.writeShot('old1', '{}');
    await store.writeShot('old2', '{}');
    const batch = [{ id: 'new', sealedEma: { ct: '1' }, shot: { env: { ct: 's' } } }];
    const res = await storeKamiBatch(batch, 'adminpub', store);
    expect(res.shots).toBe(1);
    expect(res.culled).toBe(1); // 3 shots -> cap 2 -> remove 1
    expect(await store.shotCount()).toBe(2);
  });
});
