// server/auth/adminUpdate.js — admin-gated "Update Now" request authority
// (UPD-2, v0.2.387-alpha).
//
// The QUEST side of the Quest↔Suite update CONTRACT. arena-ws NEVER runs a shell
// and NEVER installs anything: on a verified admin click it writes ONE atomic JSON
// request file into /opt/torii-quest/mp/update-requests/, and a separate root
// systemd runner (built in torii-suite) picks it up, resolves the latest tag
// ITSELF, reinstalls, and writes back /opt/torii-quest/mp/update-status.json.
//
// SECURITY (fail-closed):
//   * A request requires BOTH (checked by the caller in arena-ws): a valid session
//     token whose pubkey === the configured admin, AND a fresh signed intent event
//     whose pubkey === the configured admin. This module re-checks the event's
//     pubkey against the admin independently — never trust the caller alone.
//   * The intent event content is `torii-quest:update-now:<nonce>` (nonce ≥16 hex)
//     and its created_at must be within a 120s freshness window (anti-replay).
//   * Single-flight: refuse if a request is already pending (a file already sits in
//     the requests dir) OR the status file reports state==='running' (409).
//   * The install TARGET is never taken from the client — the file carries only the
//     installed version for the runner's reference; the runner resolves latest itself.
//   * PURE by injection: clock, RNG, fs, and the sig verifier are all injectable, so
//     the whole gate is unit-testable against a temp dir with a fake clock/verifier.

import { randomBytes } from 'crypto';
import * as nodeFs from 'fs';
import * as nodePath from 'path';
import { verifyNostrEventSig } from '../../src/engine/crypto/nostrSig.js';

export const UPDATE_ACTION = 'torii-quest:update-now';
export const INTENT_KIND = 1;                 // signed intent event kind
export const DEFAULT_FRESHNESS_MS = 120_000;  // ≤120s intent freshness window
const HEX64 = /^[0-9a-f]{64}$/;
// content is `torii-quest:update-now:<nonce>` with a ≥16 lowercase-hex nonce.
const CONTENT_RE = /^torii-quest:update-now:([0-9a-f]{16,})$/;

/**
 * Create the admin-update request authority.
 *
 * @param {object} opts
 * @param {string} opts.adminPubkeyHex     configured admin hex64 pubkey ('' = unset)
 * @param {string} opts.requestsDir        /opt/torii-quest/mp/update-requests
 * @param {string} opts.statusPath         /opt/torii-quest/mp/update-status.json
 * @param {string} [opts.installedVersion] SERVER_VERSION (reference only)
 * @param {() => number} [opts.now]        ms clock
 * @param {(n:number)=>Buffer|Uint8Array} [opts.randomBytesFn]
 * @param {object} [opts.fs]               node fs (injectable for tests)
 * @param {(evt:object)=>boolean} [opts.verifyEventSig]
 * @param {number} [opts.freshnessMs]
 */
export function createAdminUpdate(opts = {}) {
  const {
    adminPubkeyHex = '',
    requestsDir,
    statusPath,
    installedVersion = '',
    now = () => Date.now(),
    randomBytesFn = randomBytes,
    fs = nodeFs,
    verifyEventSig = verifyNostrEventSig,
    freshnessMs = DEFAULT_FRESHNESS_MS,
  } = opts;

  const admin = typeof adminPubkeyHex === 'string' ? adminPubkeyHex.toLowerCase() : '';
  const configured = HEX64.test(admin);

  /** Is this hex pubkey the configured admin? Fail-closed on any malformed input. */
  function isAdmin(pubkeyHex) {
    if (!configured) return false;
    const p = typeof pubkeyHex === 'string' ? pubkeyHex.toLowerCase() : '';
    return HEX64.test(p) && p === admin;
  }

  /** Best-effort: is the requests dir present and writable by this process? */
  function requestsDirWritable() {
    if (typeof requestsDir !== 'string' || !requestsDir) return false;
    try {
      fs.accessSync(requestsDir, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Public capability signal. autoUpdate is true only when an admin is configured
   * AND the requests dir is writable (best-effort). adminPubkey is the admin's hex
   * pubkey (a PUBLIC key) so the client can compare its own logged-in pubkey — null
   * when unset so nothing is leaked about an unconfigured instance.
   */
  function capability() {
    const autoUpdate = configured && requestsDirWritable();
    return { autoUpdate, adminPubkey: configured ? admin : null };
  }

  /** Read the runner-written status file, or { state:'unavailable' } when absent/bad. */
  function readStatus() {
    if (typeof statusPath !== 'string' || !statusPath) return { state: 'unavailable' };
    let raw;
    try { raw = fs.readFileSync(statusPath, 'utf8'); } catch { return { state: 'unavailable' }; }
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return { state: 'unavailable' }; }
    if (!parsed || typeof parsed !== 'object' || typeof parsed.state !== 'string') {
      return { state: 'unavailable' };
    }
    return parsed;
  }

  /** Is a request already pending (any *.json request file present)? */
  function _hasPendingRequest() {
    try {
      const entries = fs.readdirSync(requestsDir);
      return entries.some((f) => typeof f === 'string' && f.endsWith('.json') && !f.startsWith('.'));
    } catch {
      return false;
    }
  }

  function _randHex(nBytes) {
    const buf = randomBytesFn(nBytes);
    let hex = '';
    for (let i = 0; i < nBytes; i += 1) hex += buf[i].toString(16).padStart(2, '0');
    return hex;
  }

  /**
   * Validate a signed intent event and, on success, write the atomic request file.
   * The caller (arena-ws) must ALREADY have verified the session token and that the
   * session pubkey === admin; this re-verifies the event independently.
   *
   * @param {{ event:object }} args
   * @returns {{ ok:boolean, code:number, state?:string, nonce?:string, path?:string, error?:string }}
   */
  function requestUpdate({ event } = {}) {
    if (!configured) return { ok: false, code: 503, error: 'admin not configured' };
    if (!requestsDirWritable()) return { ok: false, code: 503, error: 'update service not available' };

    // --- verify the fresh signed intent ---
    if (!event || typeof event !== 'object') return { ok: false, code: 403, error: 'missing intent' };
    if (event.kind !== INTENT_KIND) return { ok: false, code: 403, error: 'bad intent kind' };
    if (!HEX64.test(event.pubkey || '')) return { ok: false, code: 403, error: 'bad pubkey' };
    if (event.pubkey.toLowerCase() !== admin) return { ok: false, code: 403, error: 'not admin' };
    const m = typeof event.content === 'string' ? event.content.match(CONTENT_RE) : null;
    if (!m) return { ok: false, code: 403, error: 'bad intent content' };
    const nonce = m[1];
    if (!Number.isInteger(event.created_at)) return { ok: false, code: 403, error: 'bad created_at' };
    // created_at is unix SECONDS (NIP-01). Reject stale OR future-skewed intents.
    const ageMs = now() - event.created_at * 1000;
    if (!(ageMs >= -freshnessMs && ageMs <= freshnessMs)) return { ok: false, code: 403, error: 'stale intent' };
    if (!verifyEventSig(event)) return { ok: false, code: 403, error: 'bad signature' };

    // --- single-flight ---
    const status = readStatus();
    if (status && status.state === 'running') return { ok: false, code: 409, error: 'update already running' };
    if (_hasPendingRequest()) return { ok: false, code: 409, error: 'update already requested' };

    // --- atomic write ---
    const createdAt = now();
    const fileName = `${createdAt}-${nonce}.json`;
    const finalPath = nodePath.join(requestsDir, fileName);
    const tmpPath = nodePath.join(requestsDir, `.${createdAt}-${nonce}.${_randHex(6)}.tmp`);
    const body = JSON.stringify({
      action: UPDATE_ACTION,
      nonce,
      createdAt,
      adminPubkey: admin,
      installedVersion,
    });
    try {
      fs.writeFileSync(tmpPath, body, { mode: 0o640 });
      fs.renameSync(tmpPath, finalPath);
    } catch (e) {
      try { fs.unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }
      return { ok: false, code: 503, error: `write failed: ${e && e.message ? e.message : 'error'}` };
    }
    return { ok: true, code: 200, state: 'requested', nonce, path: finalPath };
  }

  return {
    isAdmin,
    capability,
    readStatus,
    requestUpdate,
    configured,
    adminPubkeyHex: admin,
  };
}
