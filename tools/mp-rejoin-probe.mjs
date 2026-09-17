// tools/mp-rejoin-probe.mjs — LIVE cross-node MP rejoin wire probe (v0.2.866+).
//
// The MP rejoin slice (v0.2.866) makes a traveller's client re-dial the DESTINATION
// world's multiplayer WebSocket (`setWsEndpoint` → `wss://<dest>/mp`) after landing,
// authenticating with the SAME NIP-42 kind:22242 challenge the origin used. This probe
// verifies the SERVER side of that rejoin is live WITHOUT a browser: it opens a raw WSS
// to each node's /mp endpoint and reads the HELLO each server must emit on connect
// (challenge + serverVersion + protocolVersion). A healthy HELLO == the destination can
// accept a fresh rejoin dial and hand out the challenge the traveller signs.
//
// This is the wire half of the playtest; the GUI half (travel → 入 → observe the roster
// picking up the destination's peers/bots) still needs a logged-in browser — see the
// MP_REJOIN_PLAYTEST runbook.
//
// Usage:  node tools/mp-rejoin-probe.mjs [endpoint ...]
//         (defaults to the two known live nodes)

import WebSocket from 'ws';

const DEFAULTS = [
  'wss://chiefmonkey.art/mp',   // origin (traveller's home node)
  'wss://plebeian.build/mp',    // destination (Bekka's node)
];

function probeOne(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const out = { url, ok: false, reason: null, hello: null };
    const ws = new WebSocket(url, { handshakeTimeout: timeoutMs });
    const done = (r) => { try { ws.close(); } catch { /* noop */ } resolve(r); };
    const timer = setTimeout(() => done({ ...out, reason: 'timeout' }), timeoutMs);
    ws.on('open', () => { /* wait for HELLO */ });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString('utf8'));
        if (msg && msg.t === 'HELLO') {
          clearTimeout(timer);
          done({
            ...out,
            ok: true,
            hello: {
              challengePresent: typeof msg.challenge === 'string' && msg.challenge.length > 0,
              serverVersion: msg.serverVersion,
              protocolVersion: msg.protocolVersion,
            },
          });
        }
      } catch {
        clearTimeout(timer);
        done({ ...out, reason: 'non-JSON message' });
      }
    });
    ws.on('error', (e) => { clearTimeout(timer); done({ ...out, reason: e && e.message ? e.message : 'error' }); });
    ws.on('close', (code) => {
      if (!out.ok) { clearTimeout(timer); done({ ...out, reason: `closed(${code}) before HELLO` }); }
    });
  });
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULTS;
console.log('MP rejoin wire probe — reading HELLO on each /mp endpoint\n');
let failed = 0;
for (const url of targets) {
  const r = await probeOne(url);
  const status = r.ok ? 'OK ' : 'FAIL';
  if (!r.ok) failed += 1;
  console.log(`[${status}] ${url}`);
  if (r.ok) {
    console.log(`      server ${r.hello.serverVersion} · protocol ${r.hello.protocolVersion} · challenge ${r.hello.challengePresent ? 'issued' : 'MISSING'}`);
  } else {
    console.log(`      ${r.reason}`);
  }
}
console.log('');
console.log(failed === 0 ? 'all endpoints advertise a live MP server (rejoin dial would be accepted).' : `${failed} endpoint(s) failed — rejoin to those nodes is blocked.`);
process.exit(failed === 0 ? 0 : 1);