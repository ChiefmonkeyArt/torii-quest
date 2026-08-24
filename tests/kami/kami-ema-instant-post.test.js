// @vitest-environment jsdom
// tests/kami/kami-ema-instant-post.test.js — ADR-0042.
//
// The owner's ask: "when i create an ema and hit return it should just hang on
// the emagake and on the vps instantly... no need for extra step and pressing
// shift+k again". Enter must seal + POST the note immediately; Shift+K is only
// the retry path for notes that failed to POST.
//
// Drives the real installKamiMode path. The NIP-44 seal CRYPTO is already
// locked down in kami-seal.test.js — what we prove here is the sealAndPost
// WIRING end-to-end with a fake fetch:
//   1. Enter posts the note to /kami/ema exactly once.
//   2. A failed POST keeps the note on the rack (retryable).
//   3. Shift+K retries the unsent note — a second POST fires.
//
// Isolation note (vite.config poolOptions.threads.isolate:false): the suite
// shares one module registry per worker, so this file must NOT leak globals.
// It mocks the seal (no WebCrypto/globalThis.crypto override) and uses the
// pointer-lock capture path (no document.elementFromPoint override) so the
// kami-state-machine test's globals stay untouched.
import { describe, test, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('../../src/scene.js', () => ({ requestFrameGrab: () => {} }));
// The seal crypto is covered by kami-seal.test.js; here we only need sealAndPost
// to produce an opaque envelope it can POST, so a no-crypto stand-in suffices.
vi.mock('../../src/engine/kami/kamiSeal.js', () => ({
  sealJson: async () => ({ v: 1, alg: 'test', ct: 'fake-ema' }),
  sealTo: async () => ({ v: 1, alg: 'test', ct: 'fake-shot' }),
  normalisePubkey: (p) => p,
  toHex: (b) => Array.from(b || []).map((x) => x.toString(16)).join(''),
  toB64: () => 'fake',
  KAMI_SEAL_ALG: 'test',
}));
import { installKamiMode, kamiActive, kamiExit, kamiNoteOpen, kamiTrayState, kamiDiscard, __resetKamiForTests } from '../../src/engine/kami/kamiMode.js';
import { state } from '../../src/state.js';

const OWNER_PUBKEY = 'a'.repeat(64);

function bareK(shift = false) {
  document.body.dispatchEvent(new KeyboardEvent('keydown', {
    code: 'KeyK', shiftKey: shift, bubbles: true,
  }));
}
function waitForPosts(getCount, n, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (getCount() >= n) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error(`timed out waiting for ${n} posts; got ${getCount()}`));
      setTimeout(tick, 5);
    };
    tick();
  });
}
function flush(ms = 10) { return new Promise((r) => setTimeout(r, ms)); }

describe('Kami ema instant-post on Enter (ADR-0042)', () => {
  let emaPosts, failNext;
  let prevPointerLocked;

  beforeAll(() => {
    prevPointerLocked = state.pointerLocked;
    document.body.innerHTML = '<div id="emagake" hidden></div>';
    emaPosts = 0; failNext = false;
    installKamiMode({
      getOwnerPubkey: () => OWNER_PUBKEY,
      requestPointerLock: () => {},
      getDocument: () => document,
      setGameInputSuppressed: () => {},
      setShootingSuppressed: () => {},
      sendKamiState: () => {},
      // Pointer-lock capture path: playerPos reads getDebug().player.position,
      // so captureTarget returns a WORLD target without touching
      // document.elementFromPoint (which the state-machine test sets to null).
      getDebug: () => ({ player: { position: { x: 1, y: 2, z: -3 } } }),
      fetchImpl: async (url) => {
        if (typeof url === 'string' && url.includes('/kami/ema')) {
          emaPosts++;
          if (failNext) return { ok: false, status: 500, json: async () => ({}) };
          return { ok: true, status: 200, json: async () => ({ stored: 1 }) };
        }
        return { ok: true, status: 200, json: async () => ({ adminPubkey: OWNER_PUBKEY }) };
      },
    });
  });
  afterAll(() => {
    state.pointerLocked = prevPointerLocked;
    state.phase = 'playing';
    // isolate:false shares the kamiMode module across files in a worker; reset
    // every piece of module-level state this file mutated so the next kami test
    // file starts clean (no leaked _armed / _noteOpen / _tray).
    __resetKamiForTests();
  });
  beforeEach(() => {
    state.phase = 'playing';
    state.pointerLocked = true; // WORLD target via playerPos, not elementFromPoint
    for (const id of kamiTrayState().ids) kamiDiscard(id);
    emaPosts = 0; failNext = false;
    kamiExit();
    emaPosts = 0;
  });

  async function openNoteAndType(text) {
    bareK();          // 1st K → enter Kami Mode (arms owner async)
    await waitForPosts(() => (kamiActive() ? 1 : 0), 1);
    expect(kamiActive()).toBe(true);
    bareK();          // 2nd K → open the note
    await flush();
    expect(kamiNoteOpen()).toBe(true);
    const ta = document.getElementById('kami-note-input');
    expect(ta).toBeTruthy();
    ta.value = text;
  }
  function enterOnNote() {
    const ta = document.getElementById('kami-note-input');
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: false, bubbles: true }));
  }

  test('Enter seals + POSTs the note to /kami/ema exactly once (no Shift+K)', async () => {
    await openNoteAndType('bot did not flash on hit');
    enterOnNote();
    await waitForPosts(() => emaPosts, 1);
    expect(emaPosts).toBe(1);
  });

  test('a failed POST keeps the note on the rack (retryable, not lost)', async () => {
    failNext = true;
    await openNoteAndType('shot did not register');
    enterOnNote();
    await waitForPosts(() => emaPosts, 1);
    expect(emaPosts).toBe(1); // the POST fired + failed
    expect(kamiTrayState().count).toBe(1); // the note is still on the rack
  });

  test('Shift+K retries the unsent note — a second POST fires', async () => {
    failNext = true;
    await openNoteAndType('sticker did not stick');
    enterOnNote();
    await waitForPosts(() => emaPosts, 1);
    expect(kamiTrayState().count).toBe(1);

    failNext = false;
    bareK(true); // Shift+K → hangTray (send-unsent)
    await waitForPosts(() => emaPosts, 2);
    expect(emaPosts).toBe(2); // retried → second POST
  });
});
