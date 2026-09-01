// server/presence/beacon.js — ADR-0094 server-side always-on presence beacon.
//
// The multiplayer `arena-ws` server holds a dedicated secp256k1 "beacon" keypair
// and, while enabled, republishes the instance's world-presence event (kind
// 30078, topic `torii-gateway`) on a fixed cadence so the world stays listed on
// every gateway with NO browser tab open. The admin's master nsec never lives
// here: the beacon key is a fresh, instance-bound key scoped to presence only.
//
// Responsibilities (mirrors the other server authority modules — pure logic,
// I/O injected for tests):
//   - load()/persist(): the key + enabled flag survive a server restart, so a
//     reboot resumes the pulse automatically.
//   - enable()/disable(): flip + persist; enable generates the key on first use.
//   - publishOnce(): build (reusing buildPresenceEvent) + sign + fan-out publish
//     to every relay; records lastPublishedAt / lastError without throwing.
//
// Attribution (ADR-0094 §2): buildPresenceEvent sets pubkey = the beacon key and
// content.npub = the admin's npub; this module additionally stamps the admin's
// hex pubkey in a canonical ["p", <adminHex>] tag so the gateway reader can map
// the world back to the admin for Friends/Follows classification.

import * as nodeFs from 'fs';
import * as nodePath from 'path';
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { buildPresenceEvent } from '../../src/engine/gateway/worldPresence.js';
import { publishEventToRelay } from '../kami/kamiNostr.js';

// Reuse the client's republish cadence so server and client semantics agree.
export const BEACON_INTERVAL_MS = 600000; // 10 min
export const PRESENCE_EXPIRATION_TTL_SEC = 1200; // NIP-40 20 min (buildPresenceEvent default)

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;

// hex64 → Uint8Array(32), or null. nostr-tools' schnorr helpers demand a real
// Uint8Array (a Buffer is rejected by its abytes() guard).
function hexToU8(hex) {
  if (!HEX64.test(hex || '')) return null;
  const u8 = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) u8[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return u8;
}

// u8 → hex64. The reverse of hexToU8, for persisting the generated key.
function u8ToHex(u8) {
  let hex = '';
  for (let i = 0; i < u8.length; i += 1) hex += u8[i].toString(16).padStart(2, '0');
  return hex;
}

/**
 * Create the beacon authority.
 *
 * @param {object} [opts]
 * @param {string}  opts.statePath        absolute path to the beacon state JSON
 * @param {string}  opts.adminPubkeyHex    configured admin hex64 ('' = unset)
 * @param {string[]} opts.relays           wss relays to publish to (default [])
 * @param {string}  [opts.website]         public origin for the presence website field
 * @param {string}  [opts.title]           presence title (default 'Torii Quest')
 * @param {string}  [opts.zoneId]          presence zone id (default 'quest-torii')
 * @param {object}  [opts.fs]              node fs (injectable)
 * @param {() => number} [opts.now]        ms clock
 * @param {() => Uint8Array} [opts.generateKey]    default nostr-tools generateSecretKey
 * @param {(u8:Uint8Array) => string} [opts.getPubkey] default nostr-tools getPublicKey
 * @param {(evt:object, sk:Uint8Array) => object} [opts.finalize] default nostr-tools finalizeEvent
 * @param {(url,evt,o) => Promise} [opts.publishToRelay] default kamiNostr.publishEventToRelay
 * @param {(hex:string) => string} [opts.npubEncode]    default nostr-tools nip19.npubEncode
 */
export function createBeacon(opts = {}) {
  const {
    statePath,
    adminPubkeyHex = '',
    relays = [],
    website = '',
    title = 'Torii Quest',
    zoneId = 'quest-torii',
    fs = nodeFs,
    now = () => Date.now(),
    generateKey = generateSecretKey,
    getPubkey = getPublicKey,
    finalize = finalizeEvent,
    publishToRelay = publishEventToRelay,
    npubEncode = nip19.npubEncode,
  } = opts;

  const admin = typeof adminPubkeyHex === 'string' ? adminPubkeyHex.toLowerCase() : '';
  const configured = HEX64.test(admin);
  const relayList = Array.isArray(relays) ? relays.filter((r) => typeof r === 'string' && r !== '') : [];

  // In-memory state; load() hydrates it from disk at startup.
  let state = {
    version: 1,
    pubkey: null,          // beacon pubkey hex64 (public)
    secretKeyHex: null,    // beacon secret key hex64 (guard: 0600 on disk)
    enabled: false,
    activatedAt: null,     // ms, first-ever enable
    adminPubkey: configured ? admin : null,
    lastPublishedAt: null, // ms, last successful publish
    lastError: null,       // string | null, last publish failure reason
  };

  function _validPath() {
    return typeof statePath === 'string' && statePath !== '';
  }

  function _safeState(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw;
  }

  function _persist() {
    if (!_validPath()) return false;
    try {
      const dir = nodePath.dirname(statePath);
      fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
      const tmp = `${statePath}.${Math.floor(now() * 1000)}.${Math.floor(Math.random() * 1e9)}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, statePath);
      // Rename does not reset mode on all platforms; enforce 0600 defensively.
      try { fs.chmodSync(statePath, 0o600); } catch { /* best-effort */ }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Hydrate from disk at startup. Restores the key + enabled flag so a restart
   * resumes the loop with no admin re-login. Never throws; a missing/corrupt
   * file simply leaves the default (disabled, no key) state.
   * @returns {boolean} the restored `enabled` value.
   */
  function load() {
    if (!_validPath()) return false;
    let raw;
    try { raw = fs.readFileSync(statePath, 'utf8'); } catch { return false; }
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return false; }
    const s = _safeState(parsed);
    const pub = typeof s.pubkey === 'string' && HEX64.test(s.pubkey) ? s.pubkey.toLowerCase() : null;
    const sk = typeof s.secretKeyHex === 'string' && HEX64.test(s.secretKeyHex) ? s.secretKeyHex.toLowerCase() : null;
    // A keypair must be present AND consistent (pubkey actually derives from the
    // secret), else we treat it as absent and start disabled — never resume with
    // a key we cannot sign with.
    let keyOk = !!(pub && sk);
    if (keyOk) {
      const u8 = hexToU8(sk);
      let derived = null;
      if (u8) { try { derived = getPubkey(u8); } catch { derived = null; } }
      if (!derived || typeof derived !== 'string' || derived.toLowerCase() !== pub) keyOk = false;
    }
    const adminStored = typeof s.adminPubkey === 'string' && HEX64.test(s.adminPubkey) ? s.adminPubkey.toLowerCase() : null;
    state = {
      version: 1,
      pubkey: keyOk ? pub : null,
      secretKeyHex: keyOk ? sk : null,
      enabled: keyOk ? s.enabled === true : false,
      activatedAt: typeof s.activatedAt === 'number' ? s.activatedAt : null,
      adminPubkey: configured ? admin : (adminStored || null),
      lastPublishedAt: typeof s.lastPublishedAt === 'number' ? s.lastPublishedAt : null,
      lastError: typeof s.lastError === 'string' ? s.lastError : null,
    };
    return state.enabled;
  }

  /** Public, non-secret capability/state signal (like update-capability). */
  function capability() {
    return {
      enabled: state.enabled,
      activatedAt: state.activatedAt,
      pubkey: state.pubkey,
      adminPubkey: state.adminPubkey,
      lastPublishedAt: state.lastPublishedAt,
      lastError: state.lastError,
    };
  }

  /**
   * Turn the beacon on. Generates + persists the keypair on first use. Requires
   * a configured admin (fail-closed otherwise — an ownerless instance must not
   * hold a key). Returns { ok, error }.
   */
  function enable() {
    if (!configured) return { ok: false, error: 'admin-not-configured' };
    if (!_validPath()) return { ok: false, error: 'no-state-path' };
    if (!state.secretKeyHex) {
      let sk;
      try { sk = generateKey(); } catch { return { ok: false, error: 'keygen-failed' }; }
      const skHex = u8ToHex(sk);
      const pub = getPubkey(sk);
      if (!HEX64.test(pub)) return { ok: false, error: 'bad-derived-pubkey' };
      state.secretKeyHex = skHex.toLowerCase();
      state.pubkey = pub.toLowerCase();
    }
    if (state.activatedAt === null) state.activatedAt = now();
    state.enabled = true;
    state.lastError = null;
    _persist();
    return { ok: true };
  }

  /** Turn the beacon off. Persists so it stays off across restarts. */
  function disable() {
    state.enabled = false;
    _persist();
    return { ok: true };
  }

  /** Build the signed presence event (in-memory), or { ok:false, error }. */
  function _buildSignedEvent() {
    if (!state.enabled) return { ok: false, error: 'disabled' };
    if (!configured || state.adminPubkey !== admin) return { ok: false, error: 'admin-mismatch' };
    if (!state.pubkey || !state.secretKeyHex) return { ok: false, error: 'no-key' };

    let npub;
    try { npub = npubEncode(admin); } catch { npub = null; }

    const built = buildPresenceEvent({
      pubkey: state.pubkey,
      zoneId,
      title,
      zoneType: 'arena',
      website,
      relays: relayList,
      npub: npub || undefined,
    });
    if (!built || !built.ok || !built.event) return { ok: false, error: 'build-failed' };

    const event = built.event;
    // ADR-0094 §2: canonical owner marker so the reader attributes this world to
    // the admin (event.pubkey is the beacon key, not the admin).
    event.tags.push(['p', admin]);

    let sk = hexToU8(state.secretKeyHex);
    if (!sk) return { ok: false, error: 'bad-secret-key' };
    let signed;
    try { signed = finalize(event, sk); } catch { return { ok: false, error: 'sign-failed' }; }
    if (!signed || !HEX128.test(signed.sig || '') || !HEX64.test(signed.id || '')) {
      return { ok: false, error: 'sign-invalid' };
    }
    return { ok: true, event: signed };
  }

  /**
   * Build + sign + fan-out publish once. Non-throwing; updates lastPublishedAt
   * only when at least one relay accepted, else records lastError. Returns a
   * summary { ok, accepted, attempted, failures }.
   */
  async function publishOnce() {
    const builtResult = _buildSignedEvent();
    if (!builtResult.ok) {
      state.lastError = builtResult.error;
      return { ok: false, accepted: 0, attempted: 0, failures: [builtResult.error], error: builtResult.error };
    }
    if (!relayList.length) {
      state.lastError = 'no-relays';
      return { ok: false, accepted: 0, attempted: 0, failures: ['no-relays'], error: 'no-relays' };
    }

    let accepted = 0;
    const failures = [];
    for (const relay of relayList) {
      let res;
      try { res = await publishToRelay(relay, builtResult.event, { timeoutMs: 8000 }); }
      catch { res = { ok: false, reason: 'threw' }; }
      if (res && res.ok) accepted += 1;
      else failures.push((res && (res.reason || res.relay)) || relay);
    }

    if (accepted > 0) {
      state.lastPublishedAt = now();
      state.lastError = null;
      _persist();
      return { ok: true, accepted, attempted: relayList.length, failures };
    }
    state.lastError = failures.length ? `all-rejected:${failures[0]}` : 'no-acceptance';
    _persist();
    return { ok: false, accepted: 0, attempted: relayList.length, failures, error: state.lastError };
  }

  return {
    load,
    capability,
    enable,
    disable,
    publishOnce,
    getState: () => ({ ...state }),
    configured,
    adminPubkeyHex: admin,
  };
}