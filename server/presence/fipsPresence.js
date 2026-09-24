// First FIPS slice: one explicitly pinned peer, RAM only, no relay writes.
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import WebSocket from 'ws';
import { nip19 } from 'nostr-tools';
import { verifyNostrEventSig } from '../../src/engine/crypto/nostrSig.js';

export const MAX_EVENT_BYTES = 8192;
export const POLL_MS = 30000;
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
  if (!raw || raw.version !== 1 || !Array.isArray(raw.peers) || raw.peers.length > 1) {
    throw new Error('two-node proof supports at most one configured peer');
  }
  return raw.peers.map(p => {
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
    if (!stat.isFile() || stat.size > 4096 || stat.uid !== 0 || (stat.mode & 0o022)) {
      throw new Error('peer config must be root-owned, non-writable and at most 4 KiB');
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
  if (peers.length > 1) throw new Error('only one peer permitted');
  const peer = peers[0];
  let event = null, via = null, receivedAt = null, lastAttemptAt = null;
  let running = false, stopped = false, timer = null;
  const snapshot = () => ({
    // Signatures are checked on ingestion, not per public HTTP request.
    events: event && Number(event.tags.find(t => t[0] === 'expiration')[1]) > Math.floor(now() / 1000) ? [event] : [],
    configured: !!peer, error, via, receivedAt, lastAttemptAt,
  });
  async function poll() {
    if (!peer || stopped || running) return;
    running = true;
    lastAttemptAt = now();
    try {
      let candidate;
      try { candidate = await query(peer.meshUrl, peer); } catch { candidate = null; }
      let route = 'fips';
      if (!candidate || !validHeartbeat(candidate, peer, now())) {
        candidate = await query(peer.fallbackUrl, peer);
        route = 'wss';
      }
      if (!stopped && candidate && validHeartbeat(candidate, peer, now())) {
        if (!event || candidate.created_at > event.created_at
          || (candidate.created_at === event.created_at && candidate.id <= event.id)) {
          // Retain only canonical signed fields, never arbitrary relay extras.
          event = Object.fromEntries(['id', 'pubkey', 'created_at', 'kind', 'tags', 'content', 'sig']
            .map(key => [key, candidate[key]]));
          via = route;
          receivedAt = now();
        }
      }
    } catch { /* retain only until original expiry; retry at normal cadence */ }
    finally { running = false; }
  }
  function start() {
    if (timer || !peer) return;
    stopped = false;
    void poll();
    timer = setInterval(() => void poll(), POLL_MS);
    timer.unref?.();
  }
  function stop() { stopped = true; clearInterval(timer); timer = null; event = null; }
  return { snapshot, poll, start, stop };
}
