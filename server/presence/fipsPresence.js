// FIPS presence (ADR-0126, widened by ADR-0151): up to MAX_PEERS operator-pinned
// peers, read one at a time, RAM only, no relay writes.
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import WebSocket from 'ws';
import { nip19 } from 'nostr-tools';
import { verifyNostrEventSig } from '../../src/engine/crypto/nostrSig.js';

export const MAX_EVENT_BYTES = 8192;
export const POLL_MS = 30000;
export const MAX_PEERS = 8; // ADR-0151; torii-suite fips/render-config.mjs matches
export const MAX_CONFIG_BYTES = 8192;
export const BACKOFF_MS = [60000, 120000, 240000, 480000, 600000];
const HEX = /^[0-9a-f]{64}$/;
const denied = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) denied.addSubnet(net, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
denied.addSubnet('2001:db8::', 32, 'ipv6');
denied.addSubnet('2002::', 16, 'ipv6');

export function publicAddress(address) {
  const family = isIP(address);
  return family === 4 ? !denied.check(address, 'ipv4')
    : family === 6 && globalV6.check(address, 'ipv6') && !denied.check(address, 'ipv6');
}

// Pin the DNS answer used by connect; never resolve-check then resolve again.
export function publicLookup(host, opts, callback) {
  lookup(host, { all: true, verbatim: true }, (error, records) => {
    if (error || !records?.length || records.some(r => !publicAddress(r.address))) {
      callback(error || new Error('non-public fallback destination'));
    } else if (opts?.all) callback(null, records);
    else callback(null, records[0].address, records[0].family);
  });
}

export function meshAddress(npub) {
  const decoded = nip19.decode(npub);
  if (decoded.type !== 'npub' || !HEX.test(decoded.data)) throw new Error('invalid transport npub');
  const hex = 'fd' + createHash('sha256').update(Buffer.from(decoded.data, 'hex')).digest('hex').slice(0, 30);
  return hex.match(/.{4}/g).join(':');
}

// Only root-owned node configuration supplies destinations, never relay events
// or HTTP request parameters. The transport key is NOT the heartbeat signer.
export function parsePeerConfig(raw) {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.peers) || raw.peers.length > MAX_PEERS) {
    throw new Error(`at most ${MAX_PEERS} configured peers`);
  }
  const seen = new Set();
  return raw.peers.map(p => {
    for (const key of [`t:${p.transportNpub}`, `b:${p.beaconPubkey}:${p.zoneId}`]) {
      if (seen.has(key)) throw new Error('duplicate peer');
      seen.add(key);
    }
    if (!HEX.test(p.beaconPubkey) || !HEX.test(p.ownerPubkey)
      || typeof p.zoneId !== 'string' || !p.zoneId || p.zoneId.length > 128) {
      throw new Error('missing pinned heartbeat identity');
    }
    const website = new URL(p.website);
    if (website.protocol !== 'https:' || website.username || website.password
      || website.hash || website.search || website.port
      || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(website.hostname)
      || /\.(local|localhost|internal|test|invalid)$/i.test(website.hostname)) {
      throw new Error('expected a public HTTPS world URL');
    }
    return Object.freeze({
      beaconPubkey: p.beaconPubkey, ownerPubkey: p.ownerPubkey,
      zoneId: p.zoneId, website: website.href, transportNpub: p.transportNpub,
      meshUrl: `ws://[${meshAddress(p.transportNpub)}]:7778/`,
      fallbackUrl: `wss://${website.hostname}/relay`,
    });
  });
}

export function loadPeerConfig(path) {
  if (!path) return { peers: [], error: null };
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES || stat.uid !== 0 || (stat.mode & 0o022)) {
      throw new Error('peer config must be root-owned, non-writable and at most 8 KiB');
    }
    return { peers: parsePeerConfig(JSON.parse(readFileSync(path, 'utf8'))), error: null };
  } catch {
    // Bad optional configuration never prevents gameplay/server startup.
    return { peers: [], error: 'invalid-peer-config' };
  }
}

export function validHeartbeat(event, peer, now = Date.now()) {
  try {
    if (Buffer.byteLength(JSON.stringify(event)) > MAX_EVENT_BYTES
      || event.kind !== 30078 || event.pubkey !== peer.beaconPubkey
      || !Number.isSafeInteger(event.created_at) || !Array.isArray(event.tags)
      || event.tags.length > 32 || typeof event.content !== 'string'
      || event.tags.some(t => !Array.isArray(t) || t.some(v => typeof v !== 'string'))) return false;
    const one = name => {
      const tags = event.tags.filter(t => t[0] === name);
      return tags.length === 1 ? tags[0][1] : null;
    };
    const sec = Math.floor(now / 1000);
    const expiryText = one('expiration');
    if (!/^\d{1,12}$/.test(expiryText || '')) return false;
    const expiry = Number(expiryText);
    if (event.created_at > sec + 60 || event.created_at < sec - 1200
      || expiry <= sec || expiry <= event.created_at || expiry > event.created_at + 1200
      || one('d') !== peer.zoneId || one('t') !== 'torii-gateway'
      || one('p') !== peer.ownerPubkey) return false;
    const content = JSON.parse(event.content);
    if (content.zoneId !== peer.zoneId || content.website !== peer.website) return false;
    return verifyNostrEventSig(event);
  } catch { return false; }
}

// One bounded Nostr read. No persistent socket, reconnect loop, or redirects.
// maxPayload bounds decompressed frames; perMessageDeflate is disabled.
export function queryHeartbeat(url, peer, { WebSocketImpl = WebSocket, timeoutMs = 2500, now = Date.now } = {}) {
  return new Promise(resolve => {
    let socket, timer, done = false, latest = null, frames = 0, bytes = 0;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket?.terminate();
      resolve(latest);
    };
    timer = setTimeout(finish, timeoutMs);
    try {
      socket = new WebSocketImpl(url, {
        maxPayload: MAX_EVENT_BYTES + 256, perMessageDeflate: false,
        followRedirects: false, handshakeTimeout: timeoutMs,
        ...(url.startsWith('wss:') ? { lookup: publicLookup } : {}),
      });
      socket.on('error', finish);
      socket.on('close', finish);
      socket.on('open', () => {
        if (done) return;
        try { socket.send(JSON.stringify(['REQ', 'torii-fips', {
          kinds: [30078], authors: [peer.beaconPubkey], '#d': [peer.zoneId],
          '#t': ['torii-gateway'], since: Math.floor(now() / 1000) - 1200, limit: 1,
        }])); } catch { finish(); }
      });
      socket.on('message', data => {
        if (done) return;
        bytes += data.length;
        if (++frames > 8 || bytes > 32768) return finish();
        try {
          const msg = JSON.parse(data.toString());
          if (msg[1] !== 'torii-fips') return;
          if (msg[0] === 'EOSE' || msg[0] === 'CLOSED') return finish();
          if (msg[0] === 'EVENT' && validHeartbeat(msg[2], peer, now())
            && (!latest || msg[2].created_at > latest.created_at
              || (msg[2].created_at === latest.created_at && msg[2].id < latest.id))) latest = msg[2];
        } catch { /* bounded malformed frames are ignored */ }
      });
    } catch { finish(); }
  });
}

export function createFipsPresence({ peers = [], error = null, query = queryHeartbeat, now = Date.now } = {}) {
  // Defensive even for injected/internal callers.
  if (peers.length > MAX_PEERS) throw new Error(`at most ${MAX_PEERS} peers permitted`);
  // Per-peer RAM state: latest canonical event, route, failure backoff.
  const state = peers.map(peer => ({ peer, event: null, failures: 0, nextAt: 0 }));
  let via = null, receivedAt = null, lastAttemptAt = null, cursor = 0;
  let running = false, stopped = false, timer = null;
  const live = s => s.event && Number(s.event.tags.find(t => t[0] === 'expiration')[1]) > Math.floor(now() / 1000);
  const snapshot = () => ({
    // Signatures are checked on ingestion, not per public HTTP request.
    events: state.filter(live).map(s => s.event),
    configured: state.length > 0, peers: state.length, error, via, receivedAt, lastAttemptAt,
  });
  // Next peer whose backoff has elapsed, round-robin from the cursor.
  function due() {
    const t = now();
    for (let i = 0; i < state.length; i++) {
      const s = state[(cursor + i) % state.length];
      if (s.nextAt <= t) { cursor = (cursor + i + 1) % state.length; return s; }
    }
    return null;
  }
  async function poll() {
    if (!state.length || stopped || running) return;
    const s = due();
    if (!s) return;
    const { peer } = s;
    running = true;
    lastAttemptAt = now();
    let ok = false;
    try {
      let candidate;
      try { candidate = await query(peer.meshUrl, peer); } catch { candidate = null; }
      let route = 'fips';
      if (!candidate || !validHeartbeat(candidate, peer, now())) {
        try { candidate = await query(peer.fallbackUrl, peer); } catch { candidate = null; }
        route = 'wss';
      }
      if (!stopped && candidate && validHeartbeat(candidate, peer, now())) {
        ok = true;
        if (!s.event || candidate.created_at > s.event.created_at
          || (candidate.created_at === s.event.created_at && candidate.id <= s.event.id)) {
          // Retain only canonical signed fields, never arbitrary relay extras.
          s.event = Object.fromEntries(['id', 'pubkey', 'created_at', 'kind', 'tags', 'content', 'sig']
            .map(key => [key, candidate[key]]));
          via = route;
          receivedAt = now();
        }
      }
    } catch { /* retain only until original expiry; retry at normal cadence */ }
    finally {
      // A peer that keeps failing backs off so it can't use up the others' turns.
      s.failures = ok ? 0 : s.failures + 1;
      s.nextAt = s.failures ? now() + BACKOFF_MS[Math.min(s.failures, BACKOFF_MS.length) - 1] : 0;
      running = false;
    }
  }
  function start() {
    if (timer || !state.length) return;
    stopped = false;
    void poll();
    // One read in flight; each peer comes round about every POLL_MS.
    timer = setInterval(() => void poll(), Math.floor(POLL_MS / state.length));
    timer.unref?.();
  }
  function stop() { stopped = true; clearInterval(timer); timer = null; for (const s of state) s.event = null; }
  return { snapshot, poll, start, stop };
}

// ADR-0151: pick up a changed peer file (written by the Suite's root helper from
// a Continuum introduction) without restarting the game server. Checks the
// file's identity every RELOAD_MS; a bad new file keeps the error, never crashes.
export const RELOAD_MS = 30000;
export function createReloadingFipsPresence(path, {
  load = loadPeerConfig, create = createFipsPresence, stat = statSync, intervalMs = RELOAD_MS,
} = {}) {
  const stamp = () => {
    try { const s = stat(path); return `${s.ino}:${s.size}:${s.mtimeMs}`; } catch { return 'absent'; }
  };
  let seen = stamp(), current = create(load(path)), started = false, timer = null;
  function check() {
    const now = stamp();
    if (now === seen) return false;
    seen = now;
    current.stop();
    current = create(load(path));
    if (started) current.start();
    return true;
  }
  return {
    snapshot: () => current.snapshot(),
    poll: () => current.poll(),
    check,
    start() {
      if (started) return;
      started = true;
      current.start();
      if (path) { timer = setInterval(check, intervalMs); timer.unref?.(); }
    },
    stop() { started = false; clearInterval(timer); timer = null; current.stop(); },
  };
}
