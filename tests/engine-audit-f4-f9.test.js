// tests/engine-audit-f4-f9.test.js — regression lock for the quest-engine
// audit findings closed in the v0.2.840 batch: F4 (stale signing vs reconnect),
// F5 (portrait error-path cleanup), F6 (bidder socket teardown), F7 (animation
// retry after rejection), F9 (headless-hash event round-trip).
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// F4 — a stale signAuth completion must not touch a replacement socket.
// ---------------------------------------------------------------------------
import { createWsClient } from '../src/engine/multiplayer/wsClient.js';
import { MSG, PROTOCOL_VERSION, encode, decode } from '../src/engine/multiplayer/wireProtocol.js';

class FakeWS {
  static instances = [];
  constructor(url) { this.url = url; this.sent = []; this.closed = false; FakeWS.instances.push(this); }
  send(data) { this.sent.push(data); }
  close() { this.closed = true; if (this.onclose) this.onclose({ code: 1000, reason: '' }); }
  _open() { if (this.onopen) this.onopen(); }
  _message(payload) { if (this.onmessage) this.onmessage({ data: typeof payload === 'string' ? payload : encode(payload) }); }
  _closeFromServer() { this.closed = true; if (this.onclose) this.onclose({ code: 1006, reason: 'lost' }); }
}

describe('F4 — stale signAuth vs reconnect (epoch guard)', () => {
  it('does not send a stale AUTH on a replacement socket', async () => {
    FakeWS.instances.length = 0;
    let resolveAuth;
    const signAuth = () => new Promise((res) => { resolveAuth = res; });
    const timers = [];
    const client = createWsClient({
      url: 'wss://x.test/mp',
      WebSocketCtor: FakeWS,
      signAuth,
      setTimeoutFn: (fn) => { timers.push(fn); return timers.length; },
      clearTimeoutFn: () => {},
      emit: () => {},
    });

    client.connect();
    const ws1 = FakeWS.instances[0];
    ws1._open();
    ws1._message({ t: MSG.HELLO, challenge: 'c'.repeat(44), serverVersion: 'v0.2.840-alpha', protocolVersion: PROTOCOL_VERSION });
    // signAuth is now pending (epoch 1 captured). Socket 1 drops before it resolves.
    ws1._closeFromServer();
    // reconnect fires → socket 2 (epoch 2)
    timers.forEach((fn) => fn());
    const ws2 = FakeWS.instances[1];

    // stale signAuth resolves now — must be dropped, not sent on ws2.
    resolveAuth({ npub: 'n'.repeat(64), sig: 's'.repeat(128), event: {} });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    const authFrames = ws2.sent.filter((d) => { const m = decode(d); return m.ok && m.msg && m.msg.t === MSG.AUTH; });
    expect(authFrames.length).toBe(0);
  });

  it('does not tear down the replacement socket on a stale signAuth rejection', async () => {
    FakeWS.instances.length = 0;
    let rejectAuth;
    const signAuth = () => new Promise((_, rej) => { rejectAuth = rej; });
    const timers = [];
    const emitted = [];
    const client = createWsClient({
      url: 'wss://x.test/mp',
      WebSocketCtor: FakeWS,
      signAuth,
      setTimeoutFn: (fn) => { timers.push(fn); return timers.length; },
      clearTimeoutFn: () => {},
      emit: (name, payload) => emitted.push({ name, payload }),
    });

    client.connect();
    const ws1 = FakeWS.instances[0];
    ws1._open();
    ws1._message({ t: MSG.HELLO, challenge: 'c'.repeat(44), serverVersion: 'v0.2.840-alpha', protocolVersion: PROTOCOL_VERSION });
    ws1._closeFromServer();
    timers.forEach((fn) => fn());
    const ws2 = FakeWS.instances[1];

    // stale rejection must not disconnect socket 2 nor emit auth_error.
    rejectAuth(new Error('user dismissed'));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(ws2.closed).toBe(false);
    expect(emitted.some((e) => e.name === 'auth_error')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F5 — portrait renderer must release its renderer/DRACO on every path.
// ---------------------------------------------------------------------------
describe('F5 — portrait renderer cleanup is on the shared path', () => {
  it('disposes renderer + DRACO via a finally covering all returns', () => {
    const src = readFileSync(join(ROOT, 'src', 'engine', 'character', 'characterPortraitRenderer.js'), 'utf8');
    // A single finally guards every post-construction path, and every early
    // return (mesh-too-large / load-failed / encode-failed) funnels through it.
    expect(src).toMatch(/finally\s*\{/);
    expect(src).toContain('if (draco) draco.dispose()');
    expect(src).toContain('if (renderer) renderer.dispose()');
    expect(src).toContain('forceContextLoss');
    // Normalizes render/traversal failures instead of breaking the never-throws contract.
    expect(src).toContain("error: 'render-failed: '");
  });
});

// ---------------------------------------------------------------------------
// F6 — bidder-profile deadline must close sockets it still owns.
// ---------------------------------------------------------------------------
import { fetchProfiles } from '../src/engine/plebeian/plebeianRelay.js';

describe('F6 — bidder-profile socket teardown', () => {
  it('closes a never-opening socket when the deadline fires', async () => {
    vi.useFakeTimers();
    const sockets = [];
    class Fake {
      constructor(url) { this.url = url; this.closed = false; sockets.push(this); }
      send() {}
      close() { this.closed = true; if (this.onclose) this.onclose({ code: 1000 }); }
    }
    const orig = globalThis.WebSocket;
    globalThis.WebSocket = Fake;
    try {
      const p = fetchProfiles(['a'.repeat(64)], ['wss://relay.test'], 5000);
      vi.advanceTimersByTime(5000);
      const out = await p;
      expect(out.size).toBe(0);
      expect(sockets.length).toBe(1);
      expect(sockets[0].closed).toBe(true); // was never opened, still torn down
    } finally {
      globalThis.WebSocket = orig;
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// F7 — a rejected animation-library load must not poison later retries.
// ---------------------------------------------------------------------------
describe('F7 — animation-library retry after rejection', () => {
  it('re-attempts the download after a transient rejection', async () => {
    vi.resetModules();
    const mod = await import('../src/engine/animationLibrary.js');
    let calls = 0;
    const fakeGltf = {
      scene: { traverse: () => {} },
      animations: [{ name: 'Idle_02', clone() { return { name: 'Idle_02', tracks: [] }; } }],
    };
    const loader = {
      loadAsync: async () => {
        calls += 1;
        if (calls === 1) throw new Error('transient network blip');
        return fakeGltf;
      },
    };
    await expect(mod.loadAnimationLibrary(loader)).rejects.toThrow('transient network blip');
    const clips = await mod.loadAnimationLibrary(loader); // must retry, not reuse the cached rejection
    expect(calls).toBe(2);
    expect(clips instanceof Map).toBe(true);
    expect(mod.getClip('Idle_02').name).toBe('Idle_02');
  });
});

// ---------------------------------------------------------------------------
// F9 — the headless FP-body hash must survive build→parse.
// ---------------------------------------------------------------------------
import { buildCharacterEvent, parseCharacterEvent } from '../src/engine/character/characterEvent.js';

describe('F9 — headless hash event round-trip', () => {
  const SHA = 'a'.repeat(64);
  const HEADLESS = 'b'.repeat(64);

  it('preserves mesh.headlessHash through build→parse', () => {
    const manifest = { version: 1, mesh: { hash: SHA, name: 'c.glb', headlessHash: HEADLESS } };
    const event = buildCharacterEvent(manifest, { pubkey: 'e'.repeat(64) });
    const parsed = parseCharacterEvent(event);
    expect(parsed.valid).toBe(true);
    expect(parsed.manifest.mesh.headlessHash).toBe(HEADLESS);
  });

  it('keeps the legacy 2-slot mesh tag when headlessHash is absent', () => {
    const manifest = { version: 1, mesh: { hash: SHA, name: 'c.glb' } };
    const event = buildCharacterEvent(manifest);
    const meshTag = event.tags.find((t) => t[0] === 'mesh');
    expect(meshTag).toEqual(['mesh', SHA, 'c.glb']); // unchanged shape for legacy events
    const parsed = parseCharacterEvent(event);
    expect(parsed.manifest.mesh.headlessHash).toBeUndefined();
  });
});