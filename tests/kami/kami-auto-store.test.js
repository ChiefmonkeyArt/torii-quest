// tests/kami/kami-auto-store.test.js — ADR-0055. Ring store tests.
//
// A tiny in-memory fs (mirrors kami-store.test.js) exercises the ring write +
// cull logic without touching disk. Each frame is ONE {ema, shot} JSON file
// ring-culled to `keep` — a TRUE ring (no unbounded append-only index).

import { describe, it, expect } from 'vitest';
import { createAutoCapStore } from '../../server/kami/kamiAutoStore.js';
import { storeAutoCapBatch } from '../../server/kami/kamiAutoRoute.js';

function memFs() {
  const files = new Map(); // path -> { content, mtime }
  return {
    async mkdir() {},
    async writeFile(p, content) { files.set(p, { content, mtime: Date.now() + files.size }); },
    async readdir(p) {
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

function makeStore(keep = 120) {
  const fs = memFs();
  const store = createAutoCapStore({ dir: '/k', fs, keep });
  return { store, fs };
}

describe('kamiAutoStore — ring write + read', () => {
  it('writes one frame record as a single JSON file in the ring dir', async () => {
    const { store, fs } = makeStore();
    const p = await store.writeFrame('ac-1', '{"ema":1,"shot":null}');
    expect(p).toBe('/k/autocap/ac-1.json');
    expect(fs._files.has(p)).toBe(true);
    expect(fs._files.get(p).content).toBe('{"ema":1,"shot":null}');
  });

  it('frameCount reads the ring dir', async () => {
    const { store } = makeStore();
    await store.writeFrame('ac-1', '{}');
    await store.writeFrame('ac-2', '{}');
    expect(await store.frameCount()).toBe(2);
  });
});

describe('kamiAutoStore — ring cull (TRUE ring, no unbounded index)', () => {
  it('culls oldest-mtime files down to the cap', async () => {
    const { store } = makeStore(3);
    for (let i = 1; i <= 5; i++) {
      await store.writeFrame(`ac-${i}`, `{}`); // mtime increments with files.size
    }
    expect(await store.frameCount()).toBe(5);
    const removed = await store.cullFrames();
    expect(removed.length).toBe(2); // 5 - 3 cap
    expect(await store.frameCount()).toBe(3);
  });

  it('does nothing when under the cap', async () => {
    const { store } = makeStore(120);
    await store.writeFrame('ac-1', '{}');
    const removed = await store.cullFrames();
    expect(removed.length).toBe(0);
  });

  it('the autocap ring is SEPARATE from the manual ema shots ring', async () => {
    // The autocap store writes to autocap/, never to shots/ — so a full autocap
    // ring cannot evict a real manual ema screenshot.
    const { store, fs } = makeStore(2);
    await store.writeFrame('ac-1', '{}');
    expect([...fs._files.keys()].every(p => !p.includes('/shots/'))).toBe(true);
  });

  it('there is NO append-only index — disk is strictly bounded by the ring cap', async () => {
    // A separate forever-appending jsonl would grow unbounded at 1Hz; this store
    // has no such index. The ring dir IS the store.
    const { store, fs } = makeStore(2);
    for (let i = 1; i <= 10; i++) await store.writeFrame(`ac-${i}`, '{}');
    await store.cullFrames();
    // Only files inside autocap/ exist — no autocap.jsonl anywhere.
    expect([...fs._files.keys()].some(p => p.endsWith('autocap.jsonl'))).toBe(false);
    expect(await store.frameCount()).toBe(2);
  });
});

describe('storeAutoCapBatch — route helper', () => {
  it('stores each item as ONE {ema, shot} file and culls the ring', async () => {
    const { store, fs } = makeStore(120);
    const batch = [
      { id: 'ac-1', sealedEma: { v: 1 }, shot: { env: { e: 1 }, bytes: 10 } },
      { id: 'ac-2', sealedEma: { v: 1 }, shot: null },
    ];
    const result = await storeAutoCapBatch(batch, 'admin-pk', store);
    expect(result.stored).toBe(2);
    expect(result.frames).toBe(1);
    expect(result.culled).toBe(0);
    expect(fs._files.has('/k/autocap/ac-1.json')).toBe(true);
    expect(fs._files.has('/k/autocap/ac-2.json')).toBe(true);
    // The record carries the shot env + bytes.
    const rec1 = JSON.parse(fs._files.get('/k/autocap/ac-1.json').content);
    expect(rec1.ema).toEqual({ v: 1 });
    expect(rec1.shot).toEqual({ env: { e: 1 }, bytes: 10 });
    expect(rec1.requester).toBe('admin-pk');
    const rec2 = JSON.parse(fs._files.get('/k/autocap/ac-2.json').content);
    expect(rec2.shot).toBeNull();
  });
});
