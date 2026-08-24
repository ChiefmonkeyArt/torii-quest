// tests/kami/kami-auto-store.test.js — ADR-0055. Ring store tests.
//
// A tiny in-memory fs (mirrors kami-store.test.js) exercises the ring write +
// cull logic without touching disk. The route helper storeAutoCapBatch is pure
// and tested directly.

import { describe, it, expect } from 'vitest';
import { createAutoCapStore, autoCapLine } from '../../server/kami/kamiAutoStore.js';
import { storeAutoCapBatch } from '../../server/kami/kamiAutoRoute.js';

function memFs() {
  const files = new Map(); // path -> { content, mtime }
  const dirs = new Set();
  return {
    async mkdir(p) { dirs.add(p); },
    async appendFile(p, s) {
      const ex = files.get(p);
      if (ex) { ex.content += s; ex.mtime = (ex.mtime || 0) + 1; }
      else files.set(p, { content: s, mtime: 1 });
    },
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
  it('writes a frame envelope to the ring dir', async () => {
    const { store, fs } = makeStore();
    const p = await store.writeFrame('ac-1', '{"env":1}');
    expect(p).toBe('/k/autocap/ac-1.bin');
    expect(fs._files.has(p)).toBe(true);
    expect(fs._files.get(p).content).toBe('{"env":1}');
  });

  it('appends an index line to autocap.jsonl', async () => {
    const { store, fs } = makeStore();
    await store.appendIndex(autoCapLine({ id: 'ac-1', ts: 1000, requester: 'pk', sealedEma: { v: 1 }, shotId: 'ac-1.jpg' }));
    await store.appendIndex(autoCapLine({ id: 'ac-2', ts: 2000, requester: 'pk', sealedEma: { v: 1 }, shotId: null }));
    const content = fs._files.get('/k/autocap.jsonl').content;
    expect(content.split('\n').filter(Boolean).length).toBe(2);
    const first = JSON.parse(content.split('\n')[0]);
    expect(first.id).toBe('ac-1');
    expect(first.shotId).toBe('ac-1.jpg');
    expect(first.sealedEma).toEqual({ v: 1 });
  });

  it('frameCount reads the ring dir', async () => {
    const { store } = makeStore();
    await store.writeFrame('ac-1', '{}');
    await store.writeFrame('ac-2', '{}');
    expect(await store.frameCount()).toBe(2);
  });
});

describe('kamiAutoStore — ring cull', () => {
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
    // No shots/ dir should ever be touched by the autocap store.
    expect([...fs._files.keys()].every(p => !p.includes('/shots/'))).toBe(true);
  });
});

describe('storeAutoCapBatch — route helper', () => {
  it('stores each item: index line + frame, and culls', async () => {
    const { store, fs } = makeStore(120);
    const batch = [
      { id: 'ac-1', sealedEma: { v: 1 }, shot: { env: { e: 1 }, bytes: 10 } },
      { id: 'ac-2', sealedEma: { v: 1 }, shot: null },
    ];
    const result = await storeAutoCapBatch(batch, 'admin-pk', store);
    expect(result.stored).toBe(2);
    expect(result.frames).toBe(1);
    expect(result.culled).toBe(0);
    expect(fs._files.has('/k/autocap/ac-1.bin')).toBe(true);
    expect(fs._files.has('/k/autocap.jsonl')).toBe(true);
    const lines = fs._files.get('/k/autocap.jsonl').content.split('\n').filter(Boolean);
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).shotId).toBe('ac-1.jpg');
    expect(JSON.parse(lines[1]).shotId).toBeNull();
  });
});
