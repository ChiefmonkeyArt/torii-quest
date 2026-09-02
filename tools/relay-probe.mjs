// Probe each default relay with a real kind:30078 write using a throwaway key.
// Records: connect ok, EVENT accepted (OK: true/false), reason message, and whether
// a subsequent REQ round-trips the event we just wrote.
import WebSocket from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://relay.nostr.band',
];

const sk = generateSecretKey();
const pk = getPublicKey(sk);
console.log('probe pubkey:', pk);

const evtTemplate = {
  kind: 30078,
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ['d', 'quest-torii-probe'],
    ['app', 'torii-quest'],
    ['torii-relay-probe', 'true'],
  ],
  content: JSON.stringify({ probe: true, ts: Date.now() }),
};
const evt = finalizeEvent(evtTemplate, sk);

async function probe(url) {
  const result = { url, connected: false, ok: null, reason: '', roundTripped: null, err: '' };
  return new Promise((resolve) => {
    let ws;
    const timer = setTimeout(() => {
      result.err = result.err || 'timeout 10s';
      try { ws?.close(); } catch {}
      resolve(result);
    }, 10000);

    try {
      ws = new WebSocket(url, { handshakeTimeout: 5000 });
    } catch (e) {
      result.err = 'ws-ctor: ' + e.message;
      clearTimeout(timer);
      return resolve(result);
    }

    let sentReq = false;
    ws.on('open', () => {
      result.connected = true;
      ws.send(JSON.stringify(['EVENT', evt]));
    });

    ws.on('message', (buf) => {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }
      if (msg[0] === 'OK' && msg[1] === evt.id) {
        result.ok = !!msg[2];
        result.reason = msg[3] || '';
        // Now issue REQ to see if the event is queryable.
        if (result.ok && !sentReq) {
          sentReq = true;
          ws.send(JSON.stringify(['REQ', 'probe-req', { authors: [pk], kinds: [30078], limit: 5 }]));
        } else {
          clearTimeout(timer);
          ws.close();
          resolve(result);
        }
      } else if (msg[0] === 'EVENT' && msg[1] === 'probe-req' && msg[2]?.id === evt.id) {
        result.roundTripped = true;
      } else if (msg[0] === 'EOSE' && msg[1] === 'probe-req') {
        if (result.roundTripped === null) result.roundTripped = false;
        clearTimeout(timer);
        ws.close();
        resolve(result);
      } else if (msg[0] === 'NOTICE') {
        result.reason = result.reason || ('NOTICE: ' + msg[1]);
      } else if (msg[0] === 'CLOSED' && msg[1] === 'probe-req') {
        result.reason = result.reason || ('CLOSED: ' + (msg[2] || ''));
        if (result.roundTripped === null) result.roundTripped = false;
        clearTimeout(timer);
        ws.close();
        resolve(result);
      }
    });

    ws.on('error', (e) => {
      result.err = 'ws-err: ' + e.message;
    });
    ws.on('close', () => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

const results = await Promise.all(RELAYS.map(probe));
console.log('\n=== per-relay result ===');
for (const r of results) {
  console.log(JSON.stringify(r, null, 2));
}
