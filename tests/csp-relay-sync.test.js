// tests/csp-relay-sync.test.js — ADR-0120 guard: the CSP connect-src must stay in
// lockstep with DEFAULT_NODE_RELAYS. A relay that leaves the default set without a
// matching connect-src entry is a latent drift bug: the browser silently cannot
// reach it (the WebSocket open is blocked by CSP), which is exactly the class of
// bug that let damus/primal/snort/nostr.mom fall out of connect-src after ADR-0104.
import { describe, it, expect } from 'vitest';
import { DEFAULT_NODE_RELAYS } from '../src/engine/presence/nodeRelays.js';

const { CSP_DIRECTIVES } = await import('../tools/csp.mjs');

function connectSrcValue() {
  const entry = CSP_DIRECTIVES.find(([k]) => k === 'connect-src');
  return entry ? entry[1] : '';
}

describe('CSP connect-src ⟷ DEFAULT_NODE_RELAYS sync (ADR-0120)', () => {
  it('lists a connect-src covering every default relay, plus the allowed http endpoint', () => {
    const csp = connectSrcValue();
    // Same-origin + blob + the update-check endpoint are always whitelisted.
    expect(csp).toContain("'self' blob:");
    expect(csp).toContain('https://api.github.com');
    for (const relay of DEFAULT_NODE_RELAYS) {
      // e.g. 'wss://relay.damus.io' → host 'relay.damus.io'
      const host = new URL(relay).host;
      expect(csp, `connect-src must allow ${host}`).toContain(`wss://${host}`);
    }
  });

  it('has no stale relays that were removed from the default set', () => {
    const csp = connectSrcValue();
    // ADR-0104 removed these from the presence path; they must not linger.
    expect(csp).not.toContain('wss://relay.vertexlab.io');
  });
});