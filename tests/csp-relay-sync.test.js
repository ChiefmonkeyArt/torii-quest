// tests/csp-relay-sync.test.js — ADR-0120 + ADR-0149 guard. The page's connect-src must
// permit every default relay (a relay the browser cannot open is a silent drift bug),
// and the curated PREFERRED list (stage 2 of ADR-0149) must stay in lockstep with
// DEFAULT_NODE_RELAYS so switching modes never strands a relay.
import { describe, it, expect } from 'vitest';
import { DEFAULT_NODE_RELAYS } from '../src/engine/presence/nodeRelays.js';

const { CSP_DIRECTIVES, CONNECT_MODE, CONNECT_MODES, PREFERRED_CONNECT_SOURCES, connectSrcFor, isOperatorConnectSource, nginxIncludeBodyForSha, cspValueForSha } = await import('../tools/csp.mjs');

function connectSrcValue() {
  const entry = CSP_DIRECTIVES.find(([k]) => k === 'connect-src');
  return entry ? entry[1] : '';
}
// Minimal CSP source matcher for the source kinds we emit (scheme-source, host-source).
function permits(csp, url) {
  const u = new URL(url);
  return csp.split(/\s+/).some((src) => src === u.protocol || src === `${u.protocol}//${u.host}`);
}

describe('CSP connect-src (ADR-0120, ADR-0149)', () => {
  it('stage 1 is OPEN: any secure server, never http:/ws:/*', () => {
    expect(CONNECT_MODE).toBe(CONNECT_MODES.OPEN);
    const csp = connectSrcValue();
    expect(csp).toBe("'self' blob: https: wss:");
    for (const bad of ['http:', 'ws:', '*', 'data:']) expect(csp.split(' ')).not.toContain(bad);
  });

  it('the active policy permits every default relay, the update check and other nodes', () => {
    const csp = connectSrcValue();
    for (const relay of DEFAULT_NODE_RELAYS) expect(permits(csp, relay), relay).toBe(true);
    expect(permits(csp, 'https://api.github.com/repos/x')).toBe(true);
    expect(permits(csp, 'wss://plebeian.build/relay')).toBe(true); // another node's relay
    expect(permits(csp, 'https://blossom.primal.net/abc')).toBe(true); // Blossom media
    expect(permits(csp, 'http://insecure.example/')).toBe(false);
    expect(permits(csp, 'ws://insecure.example/')).toBe(false);
  });

  it('the prepared PREFERRED list covers every default relay (stage 2 is ready)', () => {
    const pref = connectSrcFor(CONNECT_MODES.PREFERRED);
    for (const relay of DEFAULT_NODE_RELAYS) expect(permits(pref, relay), relay).toBe(true);
    expect(pref).toContain('https://api.github.com');
    expect(pref).not.toContain('https: ');
    expect(PREFERRED_CONNECT_SOURCES).not.toContain('wss://relay.vertexlab.io'); // ADR-0104
  });

  it('operator additions are bare secure origins only', () => {
    const pref = connectSrcFor(CONNECT_MODES.PREFERRED, { extra: ['wss://plebeian.build', 'https://blossom.primal.net', 'http://x.example', 'wss://*.evil', "wss://a.example 'unsafe-inline'", 'wss://a.example/path', 'wss://plebeian.build'] });
    expect(pref).toContain('wss://plebeian.build');
    expect(pref).toContain('https://blossom.primal.net');
    expect(pref.split(' ').filter((s) => s === 'wss://plebeian.build')).toHaveLength(1);
    for (const bad of ['http://x.example', '*.evil', 'unsafe-inline', '/path']) expect(pref).not.toContain(bad);
    expect(isOperatorConnectSource('wss://localhost')).toBe(false);
    expect(() => connectSrcFor('everything')).toThrow();
  });

  it('nginx nodes get the same per-build policy as an include (dist/csp.nginx.conf)', () => {
    const sha = 'sha256-' + 'A'.repeat(43) + '=';
    const body = nginxIncludeBodyForSha(sha);
    expect(body).toContain(`add_header Content-Security-Policy "${cspValueForSha(sha)}" always;`);
    expect(body.split('\n').filter((l) => l.startsWith('add_header'))).toHaveLength(1);
    expect(() => nginxIncludeBodyForSha('sha256-x"; add_header X "y')).toThrow();
  });
});
