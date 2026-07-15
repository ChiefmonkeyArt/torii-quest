import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state } from '../src/state.js';
import { EV, on, off } from '../src/events.js';
import { fetchProfileProgressive, PROFILE_SETTLE_MS } from '../src/nostr.js';

class FakeWS {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.sent = [];
    this.readyState = 0;
    this.closed = false;
    FakeWS.instances.push(this);
  }

  send(data) {
    this.sent.push(data);
  }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closed = true;
    if (this.onclose) this.onclose({ code: 1000, reason: '' });
  }

  open() {
    this.readyState = 1;
    if (this.onopen) this.onopen();
  }

  event(payload) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(['EVENT', this.subId(), payload]) });
  }

  eose() {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(['EOSE', this.subId()]) });
  }

  fail() {
    if (this.onerror) this.onerror(new Error('socket failed'));
  }

  subId() {
    for (const raw of this.sent) {
      const frame = JSON.parse(raw);
      if (frame[0] === 'REQ') return frame[1];
    }
    return 'missing-sub';
  }

  frames(verb) {
    return this.sent.map((raw) => JSON.parse(raw)).filter((frame) => frame[0] === verb);
  }
}

function makeDom() {
  const nodes = {
    'nostr-display-name': { textContent: '', style: {} },
    'nostr-avatar-img': { src: '', style: { display: 'none' } },
    'nostr-avatar-ph': { style: { display: 'block' } },
    'stats-status': { textContent: '', style: {} },
  };
  globalThis.document = { getElementById: (id) => nodes[id] || null };
  return nodes;
}

function profileEvent({ created_at, name, picture }) {
  return {
    id: `${created_at}`.padStart(64, 'a'),
    pubkey: 'f'.repeat(64),
    created_at,
    kind: 0,
    tags: [],
    content: JSON.stringify({ name, picture }),
    sig: 'b'.repeat(128),
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('fetchProfileProgressive', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWS.instances.length = 0;
    makeDom();
    state.nostrPubkey = 'c'.repeat(64);
    state.nostrName = 'CAFEBABE';
    state.nostrAvatar = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.document;
    FakeWS.instances.length = 0;
  });

  it('applies the first profile event before slower relays reach EOSE', async () => {
    const seen = [];
    const handler = (payload) => seen.push(payload);
    on(EV.NOSTR_LOGIN, handler);
    try {
      const promise = fetchProfileProgressive('c'.repeat(64), {
        relays: ['wss://a.test', 'wss://b.test', 'wss://c.test', 'wss://d.test'],
        WebSocketCtor: FakeWS,
        settleMs: PROFILE_SETTLE_MS,
        timeoutMs: 5000,
      });
      expect(FakeWS.instances).toHaveLength(4);
      FakeWS.instances.forEach((ws) => ws.open());
      const slowDone = { value: false };
      promise.then(() => { slowDone.value = true; });

      FakeWS.instances[0].event(profileEvent({ created_at: 10, name: 'Fast Name', picture: 'https://img.test/fast.png' }));
      await flush();

      expect(state.nostrName).toBe('Fast Name');
      expect(state.nostrAvatar).toBe('https://img.test/fast.png');
      expect(document.getElementById('nostr-display-name').textContent).toBe('Fast Name');
      expect(seen.at(-1)).toEqual({
        pubkey: 'c'.repeat(64),
        name: 'Fast Name',
        avatar: 'https://img.test/fast.png',
      });
      expect(slowDone.value).toBe(false);

      await vi.advanceTimersByTimeAsync(500);
      expect(slowDone.value).toBe(false);

      FakeWS.instances[1].eose();
      FakeWS.instances[2].eose();
      await flush();
      expect(slowDone.value).toBe(false);

      await vi.advanceTimersByTimeAsync(PROFILE_SETTLE_MS);
      await promise;
    } finally {
      off(EV.NOSTR_LOGIN, handler);
    }
  });

  it('re-applies a fresher later event and ignores stale later events', async () => {
    const seen = [];
    const handler = (payload) => seen.push(payload);
    on(EV.NOSTR_LOGIN, handler);
    try {
      const promise = fetchProfileProgressive('c'.repeat(64), {
        relays: ['wss://a.test', 'wss://b.test', 'wss://c.test', 'wss://d.test'],
        WebSocketCtor: FakeWS,
        settleMs: PROFILE_SETTLE_MS,
        timeoutMs: 5000,
      });
      FakeWS.instances.forEach((ws) => ws.open());

      FakeWS.instances[0].event(profileEvent({ created_at: 10, name: 'Older Name', picture: 'https://img.test/older.png' }));
      await flush();
      expect(state.nostrName).toBe('Older Name');
      expect(seen).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(250);
      FakeWS.instances[1].event(profileEvent({ created_at: 25, name: 'Newer Name', picture: 'https://img.test/newer.png' }));
      await flush();
      expect(state.nostrName).toBe('Newer Name');
      expect(state.nostrAvatar).toBe('https://img.test/newer.png');
      expect(seen).toHaveLength(2);

      FakeWS.instances[2].event(profileEvent({ created_at: 25, name: 'Equal Name', picture: 'https://img.test/equal.png' }));
      FakeWS.instances[3].event(profileEvent({ created_at: 24, name: 'Stale Name', picture: 'https://img.test/stale.png' }));
      await flush();
      expect(state.nostrName).toBe('Newer Name');
      expect(state.nostrAvatar).toBe('https://img.test/newer.png');
      expect(seen).toHaveLength(2);

      await vi.advanceTimersByTimeAsync(PROFILE_SETTLE_MS);
      await promise;
    } finally {
      off(EV.NOSTR_LOGIN, handler);
    }
  });

  it('preserves the npub-prefix fallback when no relay returns a profile event', async () => {
    const seen = [];
    const handler = (payload) => seen.push(payload);
    on(EV.NOSTR_LOGIN, handler);
    try {
      const promise = fetchProfileProgressive('c'.repeat(64), {
        relays: ['wss://a.test', 'wss://b.test', 'wss://c.test', 'wss://d.test'],
        WebSocketCtor: FakeWS,
        settleMs: PROFILE_SETTLE_MS,
        timeoutMs: 5000,
      });
      FakeWS.instances.forEach((ws) => ws.open());

      await vi.advanceTimersByTimeAsync(5000);
      const result = await promise;

      expect(result.ok).toBe(false);
      expect(state.nostrName).toBe('CAFEBABE');
      expect(state.nostrAvatar).toBe(null);
      expect(seen).toEqual([]);
    } finally {
      off(EV.NOSTR_LOGIN, handler);
    }
  });

  it('sends CLOSE and closes every remaining socket during cleanup', async () => {
    const promise = fetchProfileProgressive('c'.repeat(64), {
      relays: ['wss://a.test', 'wss://b.test', 'wss://c.test', 'wss://d.test'],
      WebSocketCtor: FakeWS,
      settleMs: PROFILE_SETTLE_MS,
      timeoutMs: 5000,
    });
    FakeWS.instances.forEach((ws) => ws.open());
    FakeWS.instances[0].event(profileEvent({ created_at: 12, name: 'Cleanup Name', picture: 'https://img.test/cleanup.png' }));
    await flush();

    await vi.advanceTimersByTimeAsync(PROFILE_SETTLE_MS);
    await promise;

    for (const ws of FakeWS.instances) {
      const closeFrames = ws.frames('CLOSE');
      expect(closeFrames).toHaveLength(1);
      expect(closeFrames[0]).toEqual(['CLOSE', ws.subId()]);
      expect(ws.closed).toBe(true);
      expect(ws.readyState).toBe(3);
    }
  });
});
