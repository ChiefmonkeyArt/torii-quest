// gateway-ws-tag.test.js — MP-1 extension of the kind:30078 gateway destination
// record with an optional ["ws", "wss://.../mp"] endpoint tag.
//
// The three properties we lock:
//   1. buildPresenceEvent(input) accepts an optional `wsEndpoint` and emits it
//      both as a top-level `["ws", ...]` tag AND in the content JSON.
//   2. Missing/invalid `wsEndpoint` MUST NOT appear in the tags (backwards-compat).
//   3. readGateways() surfaces `wsEndpoint` on the parsed gateway record,
//      preferring the tag over the content (tag beats attacker-controlled JSON).
//
// Pure — no relay, no signing.

import { describe, it, expect } from 'vitest';
import { buildPresenceEvent, _safeWss } from '../../src/engine/gateway/worldPresence.js';
import { GATEWAY_KIND, GATEWAY_TOPIC, readGateways, GATEWAY_FIELDS } from '../../src/engine/gateway/gatewayRead.js';

const HEX_A = 'a'.repeat(64);

// Convenience: sign-less "signed" event — we only need pubkey + id-like shape for
// readGateways, which doesn't crypto-verify (that's a separate SEC layer).
function toRead(evt) {
  return {
    ...evt,
    id: 'd'.repeat(64),
    sig: 'e'.repeat(128),
  };
}

describe('buildPresenceEvent — MP-1 ws endpoint tag', () => {
  it('emits a ["ws", url] tag when a valid wss endpoint is provided', () => {
    const out = buildPresenceEvent({
      pubkey: HEX_A, zoneId: 'z-1', title: 'Test',
      wsEndpoint: 'wss://example.tld/mp',
    });
    expect(out.ok).toBe(true);
    const wsTag = out.event.tags.find((t) => t[0] === 'ws');
    expect(wsTag).toBeDefined();
    expect(wsTag[1]).toBe('wss://example.tld/mp');
    // Also mirrored inside the content JSON.
    const content = JSON.parse(out.event.content);
    expect(content.wsEndpoint).toBe('wss://example.tld/mp');
  });

  it('omits the tag when wsEndpoint is missing (backwards-compat)', () => {
    const out = buildPresenceEvent({ pubkey: HEX_A, zoneId: 'z-1', title: 'Test' });
    expect(out.ok).toBe(true);
    expect(out.event.tags.find((t) => t[0] === 'ws')).toBeUndefined();
    const content = JSON.parse(out.event.content);
    expect(content.wsEndpoint).toBeUndefined();
  });

  it('rejects plain ws:// (no TLS) and creds-in-URL', () => {
    expect(_safeWss('ws://example.tld/mp')).toBeNull();
    expect(_safeWss('wss://user:pass@example.tld/mp')).toBeNull();
    expect(_safeWss('not a url')).toBeNull();
    expect(_safeWss(null)).toBeNull();
  });
});

describe('readGateways — MP-1 ws endpoint surfacing', () => {
  it('parses wsEndpoint from the ["ws", ...] tag', () => {
    const built = buildPresenceEvent({
      pubkey: HEX_A, zoneId: 'z-1', title: 'Zone One',
      wsEndpoint: 'wss://a.tld/mp',
    });
    const evt = toRead(built.event);
    const { gateways } = readGateways({ events: [evt] });
    expect(gateways).toHaveLength(1);
    expect(gateways[0].wsEndpoint).toBe('wss://a.tld/mp');
  });

  it('surfaces null when no ws tag or content field is present', () => {
    const built = buildPresenceEvent({ pubkey: HEX_A, zoneId: 'z-2', title: 'Zone Two' });
    const evt = toRead(built.event);
    const { gateways } = readGateways({ events: [evt] });
    expect(gateways).toHaveLength(1);
    expect(gateways[0].wsEndpoint).toBeNull();
  });

  it('prefers the ws tag over the content JSON when both are present', () => {
    // Hand-craft an event where content and tag disagree — the tag is signed
    // over as part of the event id, so it's the authoritative source.
    const evt = {
      kind: GATEWAY_KIND, pubkey: HEX_A, created_at: 1_000_000,
      tags: [['d', 'z-3'], ['t', GATEWAY_TOPIC], ['ws', 'wss://real.tld/mp']],
      content: JSON.stringify({ zoneId: 'z-3', title: 'x', wsEndpoint: 'wss://spoof.tld/mp' }),
      id: 'd'.repeat(64), sig: 'e'.repeat(128),
    };
    const { gateways } = readGateways({ events: [evt] });
    expect(gateways).toHaveLength(1);
    expect(gateways[0].wsEndpoint).toBe('wss://real.tld/mp');
  });

  it('GATEWAY_FIELDS advertises wsEndpoint', () => {
    expect(GATEWAY_FIELDS).toContain('wsEndpoint');
  });
});
