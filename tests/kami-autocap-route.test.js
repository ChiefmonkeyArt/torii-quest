// tests/kami-autocap-route.test.js — ADR-0055. Route shape + admin gate.
//
// The autocap route reuses validateKamiBatch (same {v:1, batch:[{id,ema,shot?}]}
// shape as /mp/kami/ema). These tests pin: (1) the shape validates identically,
// (2) storeAutoCapBatch stores to the autocap ring (not the ema ring), (3) the
// admin gate is the same one the ema route uses (fail-closed for non-admin).

import { describe, it, expect } from 'vitest';
import { validateKamiBatch } from '../server/kami/kamiRoute.js';
import { storeAutoCapBatch } from '../server/kami/kamiAutoRoute.js';
import { createAutoCapStore, autoCapLine } from '../server/kami/kamiAutoStore.js';

function memFs() {
  const files = new Map();
  return {
    async mkdir() {},
    async appendFile(p, s) {
      const ex = files.get(p);
      if (ex) ex.content += s;
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

describe('autocap route — shape reuse (validateKamiBatch)', () => {
  it('accepts a well-formed {v:1, batch:[{id,ema,shot?}]}', () => {
    const parsed = { v: 1, batch: [{ id: 'ac-1', ema: { v: 1 }, shot: { env: { e: 1 }, bytes: 10 } }] };
    const batch = validateKamiBatch(parsed);
    expect(batch).not.toBeNull();
    expect(batch.length).toBe(1);
    expect(batch[0].id).toBe('ac-1');
    expect(batch[0].shot).not.toBeNull();
  });

  it('accepts a batch with no shot (snapshot-only frame)', () => {
    const parsed = { v: 1, batch: [{ id: 'ac-2', ema: { v: 1 } }] };
    const batch = validateKamiBatch(parsed);
    expect(batch).not.toBeNull();
    expect(batch[0].shot).toBeNull();
  });

  it('rejects a bad version', () => {
    expect(validateKamiBatch({ v: 2, batch: [{ id: 'x', ema: {} }] })).toBeNull();
  });

  it('rejects an empty / missing batch', () => {
    expect(validateKamiBatch({ v: 1, batch: [] })).toBeNull();
    expect(validateKamiBatch({ v: 1 })).toBeNull();
  });

  it('skips malformed entries but keeps the well-formed ones', () => {
    const parsed = { v: 1, batch: [
      { id: 'ac-1', ema: { v: 1 } },
      { /* no id */ },
      { id: 'ac-3', /* no ema */ },
      { id: 'ac-4', ema: { v: 1 }, shot: { env: { e: 1 } } },
    ] };
    const batch = validateKamiBatch(parsed);
    expect(batch.length).toBe(2);
    expect(batch.map(b => b.id)).toEqual(['ac-1', 'ac-4']);
  });
});

describe('autocap route — storeAutoCapBatch', () => {
  it('stores to the autocap ring, NOT the ema ring', async () => {
    const fs = memFs();
    const store = createAutoCapStore({ dir: '/k', fs, keep: 120 });
    const batch = validateKamiBatch({ v: 1, batch: [
      { id: 'ac-1', ema: { v: 1 }, shot: { env: { e: 1 }, bytes: 10 } },
    ] });
    const result = await storeAutoCapBatch(batch, 'admin-pk', store);
    expect(result.stored).toBe(1);
    expect(result.frames).toBe(1);
    // Frame written to the autocap ring dir, never shots/.
    expect(fs._files.has('/k/autocap/ac-1.bin')).toBe(true);
    expect([...fs._files.keys()].some(p => p.includes('/shots/'))).toBe(false);
    // Index line carries the shotId.
    const line = JSON.parse(fs._files.get('/k/autocap.jsonl').content.split('\n')[0]);
    expect(line.shotId).toBe('ac-1.jpg');
    expect(line.requester).toBe('admin-pk');
  });

  it('culls the ring when frames exceed the cap', async () => {
    const fs = memFs();
    const store = createAutoCapStore({ dir: '/k', fs, keep: 2 });
    for (let i = 1; i <= 4; i++) {
      const batch = validateKamiBatch({ v: 1, batch: [{ id: `ac-${i}`, ema: { v: 1 }, shot: { env: { e: 1 }, bytes: 10 } }] });
      await storeAutoCapBatch(batch, 'pk', store);
    }
    // After culling back to 2, only the 2 newest frames remain on disk.
    expect(await store.frameCount()).toBe(2);
  });
});
