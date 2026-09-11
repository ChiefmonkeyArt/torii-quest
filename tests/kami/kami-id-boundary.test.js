// kami-id-boundary.test.js — audit F10: Kami record IDs must be constrained to a
// safe filesystem-name grammar before they become `${id}.bin` / `${id}.json`.
// Probes every traversal surface the finding named: slash, backslash, relative
// `..`, absolute paths, leading dots, and the acceptable `ema_<base36>_<hex6>`.
import { describe, it, expect } from 'vitest';
import { isValidKamiId } from '../../server/kami/kamiId.js';
import { validateKamiBatch } from '../../server/kami/kamiRoute.js';
import { createKamiStore } from '../../server/kami/kamiStore.js';
import { createAutoCapStore } from '../../server/kami/kamiAutoStore.js';

// Minimal record-only fs: the write path is what F10 guards, so it just needs
// mkdir/mkdir + writeFile to succeed and record (key, path).
function memFs() {
  const written = [];
  return {
    writes: written,
    async mkdir() {},
    async appendFile() {},
    async writeFile(p, content) { written.push(p); },
    async readdir() { return []; },
    async stat() { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
    async unlink() {},
  };
}

describe('isValidKamiId', () => {
  it('accepts the client-generated ema_<base36>_<hex6> form', () => {
    expect(isValidKamiId('ema_lmnopqrst_12ab34')).toBe(true);
    expect(isValidKamiId('a0')).toBe(true);
    expect(isValidKamiId('s0')).toBe(true);
    expect(isValidKamiId('ac-1')).toBe(true);
  });

  it('rejects slashes, backslashes, traversal, absolute paths and leading dots', () => {
    for (const bad of [
      '../outside', 'a/b', 'a\\b', '/etc/passwd', 'C:\\x',
      '..', '.', '..hidden', './x', 'a..b', '', // note: '.' and '..' have no alnum start
      'ema_'+'x'.repeat(70), // over 64 chars
    ]) {
      expect(isValidKamiId(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('validateKamiBatch — rejects a traversal id before it reaches disk', () => {
  it('filters out unsafe ids while keeping well-formed entries', () => {
    const batch = validateKamiBatch({ v: 1, batch: [
      { id: 'ema_ok_000001', ema: { ct: '1' } },
      { id: '../evil', ema: { ct: '2' } },
      { id: 'a/b', ema: { ct: '3' } },
      { id: '/abs', ema: { ct: '4' } },
      { id: 'ok2', ema: { ct: '5' } },
    ]});
    expect(batch.map((b) => b.id)).toEqual(['ema_ok_000001', 'ok2']);
  });
});

describe('kamiStore.writeShot — fail closed on an unsafe id', () => {
  it('throws and writes nothing for a traversal id', async () => {
    const fs = memFs();
    const store = createKamiStore({ dir: '/k', fs });
    await expect(store.writeShot('../../etc/passwd', '{}')).rejects.toThrow(/invalid record id/);
    expect(fs.writes).toEqual([]);
    await expect(store.writeShot('a/b', '{}')).rejects.toThrow(/invalid record id/);
    expect(fs.writes).toEqual([]);
  });

  it('writes a valid id into shots/ unchanged', async () => {
    const fs = memFs();
    const store = createKamiStore({ dir: '/k', fs });
    const p = await store.writeShot('ema_ok_000001', '{"env":1}');
    expect(p).toContain('/shots/ema_ok_000001.bin');
    expect(fs.writes).toEqual([p]);
  });
});

describe('kamiAutoStore.writeFrame — fail closed on an unsafe id', () => {
  it('throws and writes nothing for a backslash/absolute id', async () => {
    const fs = memFs();
    const store = createAutoCapStore({ dir: '/k', fs });
    await expect(store.writeFrame('C:\\evil', '{}')).rejects.toThrow(/invalid record id/);
    await expect(store.writeFrame('..\\evil', '{}')).rejects.toThrow(/invalid record id/);
    expect(fs.writes).toEqual([]);
  });

  it('writes a valid id into autocap/ unchanged', async () => {
    const fs = memFs();
    const store = createAutoCapStore({ dir: '/k', fs });
    const p = await store.writeFrame('ac-1', '{"ema":1}');
    expect(p).toContain('/autocap/ac-1.json');
    expect(fs.writes).toEqual([p]);
  });
});