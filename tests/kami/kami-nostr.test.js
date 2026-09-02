// kami-nostr.test.js — ADR-0040 Stage 1. Tests for the NIP-17 gift-wrap helpers
// + relay publisher. The crypto round-trip uses a TEST recipient keypair (not the
// real owner key, which lives in the user's Nostr extension); no live relay.

import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, nip17 } from 'nostr-tools';
import { buildGiftWrap, publishEventToRelay, REPLY_TEXT_CAP, DEFAULT_NOSTR_RELAYS } from '../../server/kami/kamiNostr.js';

function testOwner() {
  // recipient = the owner (Kami encrypts TO this public key only)
  const priv = generateSecretKey();
  const pub = getPublicKey(priv); // hex string
  return { priv, pub };
}

describe('buildGiftWrap (NIP-17 round-trip)', () => {
  it('wraps a message the recipient can unwrap with their private key', () => {
    const owner = testOwner();
    const kamiPriv = '01'.repeat(32); // any valid 32-byte hex scalar (sender)
    const built = buildGiftWrap({ kamiPrivHex: kamiPriv, ownerPubHex: owner.pub, text: 'hello from Kami' });
    expect(built.ok).toBe(true);
    expect(built.wrap.kind).toBe(1059);
    expect(built.wrap.sig).toBeTruthy();
    const pTag = built.wrap.tags.find(t => t[0] === 'p');
    expect(pTag[1].toLowerCase()).toBe(owner.pub.toLowerCase());

    // recipient unwraps with their own private key
    const rumor = nip17.unwrapEvent(built.wrap, owner.priv);
    expect(rumor.content).toBe('hello from Kami');
    // inner rumor is a NIP-17 private direct message (kind 14), sender = Kami's pubkey
    expect(rumor.kind).toBe(14);
    const kamiPrivBytes = Uint8Array.from((kamiPriv.match(/.{2}/g) || []).map(h => parseInt(h, 16)));
    expect(rumor.pubkey.toLowerCase()).toBe(getPublicKey(kamiPrivBytes).toLowerCase());
  });

  it('rejects the wrong recipient key', () => {
    const owner = testOwner();
    const kamiPriv = '02'.repeat(32);
    const built = buildGiftWrap({ kamiPrivHex: kamiPriv, ownerPubHex: owner.pub, text: 'secret' });
    const intruder = generateSecretKey();
    expect(() => nip17.unwrapEvent(built.wrap, intruder)).toThrow();
  });

  it('caps text to REPLY_TEXT_CAP and trims whitespace', () => {
    const owner = testOwner();
    const long = 'x'.repeat(REPLY_TEXT_CAP + 50);
    const built = buildGiftWrap({ kamiPrivHex: '03'.repeat(32), ownerPubHex: owner.pub, text: '   ' + long + '   ' });
    expect(built.ok).toBe(true);
    expect(built.text.length).toBe(REPLY_TEXT_CAP);
  });

  it('fails on empty text, bad key, bad owner pubkey', () => {
    const owner = testOwner();
    expect(buildGiftWrap({ kamiPrivHex: '03'.repeat(32), ownerPubHex: owner.pub, text: '   ' }).ok).toBe(false);
    expect(buildGiftWrap({ kamiPrivHex: 'nothex', ownerPubHex: owner.pub, text: 'hi' }).error).toBe('bad-kami-priv');
    expect(buildGiftWrap({ kamiPrivHex: '03'.repeat(32), ownerPubHex: 'nothex', text: 'hi' }).error).toBe('bad-owner-pubkey');
  });
});

// A fake WebSocket constructor for the relay publisher. publishEventToRelay
// calls `new WS(url)`, so WS must be a constructor. Each instance records the
// frame it was told to send; the test drives onopen/onmessage via microtasks.
function makeFakeWS(frames) {
  function FakeWS(url) {
    this.url = url;
    this.onopen = null; this.onmessage = null; this.onerror = null; this.onclose = null;
    this.sent = null;
    this.close = function () {};
    FakeWS.instances.push(this);
    const self = this;
    queueMicrotask(() => { if (self.onopen) self.onopen(); });
    if (frames.length) queueMicrotask(() => { for (const f of frames) if (self.onmessage) self.onmessage({ data: f }); });
  }
  FakeWS.prototype.send = function (s) { this.sent = s; };
  FakeWS.instances = [];
  return FakeWS;
}

function makeThrowingWS() {
  function BadWS(url) { throw new Error('boom'); }
  return BadWS;
}

describe('publishEventToRelay', () => {
  it('resolves accepted=true on an OK frame and sends ["EVENT", event]', async () => {
    const event = { id: 'a'.repeat(64), kind: 1059, pubkey: 'b'.repeat(64), content: 'x', sig: 'c'.repeat(128), tags: [] };
    const FakeWS = makeFakeWS([JSON.stringify(['OK', event.id, true, ''])]);
    const res = await publishEventToRelay('wss://x', event, { WebSocketCtor: FakeWS, timeoutMs: 500 });
    expect(res.accepted).toBe(true);
    const sent = JSON.parse(FakeWS.instances[0].sent);
    expect(sent[0]).toBe('EVENT');
    expect(sent[1].id).toBe(event.id);
  });

  it('resolves accepted=false on a rejected OK frame', async () => {
    const event = { id: 'a'.repeat(64), kind: 1059, pubkey: 'b'.repeat(64), content: 'x', sig: 'c'.repeat(128), tags: [] };
    const FakeWS = makeFakeWS([JSON.stringify(['OK', event.id, false, 'rate-limited'])]);
    const res = await publishEventToRelay('wss://x', event, { WebSocketCtor: FakeWS, timeoutMs: 500 });
    expect(res.accepted).toBe(false);
    expect(res.reason).toBe('rate-limited');
  });

  it('returns ok=false when there is no WebSocket constructor', async () => {
    const res = await publishEventToRelay('wss://x', { id: 'a'.repeat(64) }, { WebSocketCtor: null, timeoutMs: 200 });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('no-websocket');
  });

  it('times out with no response', async () => {
    const event = { id: 'a'.repeat(64), kind: 1059, pubkey: 'b'.repeat(64), content: 'x', sig: 'c'.repeat(128), tags: [] };
    const FakeWS = makeFakeWS([]); // never sends OK
    const res = await publishEventToRelay('wss://x', event, { WebSocketCtor: FakeWS, timeoutMs: 80 });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('timeout');
  });

  it('returns ok=false bad-url when the constructor throws', async () => {
    const res = await publishEventToRelay('wss://x', { id: 'a'.repeat(64) }, { WebSocketCtor: makeThrowingWS(), timeoutMs: 200 });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('bad-url');
  });
});

describe('DEFAULT_NOSTR_RELAYS', () => {
  it('includes the plebeian staging relay', () => {
    expect(DEFAULT_NOSTR_RELAYS).toContain('wss://relay.staging.plebeian.market');
  });
});
