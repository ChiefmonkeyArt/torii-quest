// engine/gateway/handshakeController.js — live n2n handshake state machine (P1, v0.2.252).
// The stateful controller that drives the signed travel-request handshake end to
// end. Holds OUR outgoing travel request (traveller side) + the latest incoming
// request addressed to us (host side) + a verified armed accept, and renders a
// view-model the host (main.js) paints into the gateway card.
//
// DOM-free + testable: all live I/O (fanoutReq read, signEvent sign, fanoutPublish
// publish) is INJECTED. The controller never touches document/window. main.js is
// the only place DOM is touched (it renders view() + attaches click handlers).
//
// Single-poll design: NIP-01 relays only index SINGLE-LETTER tags, so we cannot
// filter by the `state` tag. Instead we poll `#p`=[ourPubkey] + kinds + #t, which
// returns every kind-30078 torii-gateway event ADDRESSED TO US — that is both
// incoming REQUESTS (we are the host p-tag) and RESPONSES to our outgoing
// requests (we are the traveller p-tag). readTravelRequests + readTravelResponses
// split them client-side (each reader rejects the wrong state). One poll, both
// sides. Our own published events are signed by us but addressed to the OTHER
// party, so #p=[ourPubkey] never echoes them back. Clean.

import {
  buildTravelRequest, buildTravelResponse,
  readTravelRequests, readTravelResponses,
} from './travelRequest.js';
import { verifyHandoff } from './handoffVerify.js';
import { verifyArrival, readArrivingTraveller, decideArrivalAdmission } from './handoffArrival.js';
import { buildGatewayFilter } from './gatewayRead.js';

const HEX64 = /^[0-9a-f]{64}$/;

// createHandshakeController({ request, sign, publish, relays, ourPubkey }) →
// controller. `request`/`sign`/`publish` are the injected nostr.js transports
// (fanoutReq / signEvent / fanoutPublish). All optional until login; the
// controller no-ops cleanly when ourPubkey is unset.
export function createHandshakeController(opts = {}) {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  let _request = typeof o.request === 'function' ? o.request : null;
  let _sign = typeof o.sign === 'function' ? o.sign : null;
  let _publish = typeof o.publish === 'function' ? o.publish : null;
  let _relays = Array.isArray(o.relays) ? o.relays : [];
  let _ourPubkey = typeof o.ourPubkey === 'string' ? o.ourPubkey : '';

  // Traveller side: the request we sent + are awaiting an accept for.
  let _pending = null; // { requestId, requestEventId, hostPubkey, toZone, title }
  // Host side: the latest incoming request addressed to us.
  let _incoming = null; // sanitised request model
  // A verified armed accept — the hop may proceed (Phase 2 executes the jump).
  let _armed = null; // { toZone, spawn, hostPubkey, title }
  // P2 host side: travellers we ACCEPTED whose signed request crypto-verified,
  // keyed by traveller pubkey. On arrival (admitArrival) we re-run verifyArrival
  // against the stored signed request before seating the arriving npub.
  const _acceptedTravellers = new Map(); // travellerPubkey → sanitised signed request
  let _lastError = null;
  let _busy = false; // guards against re-entrant ticks

  function _ready() {
    return !!(_request && _sign && _publish && _relays.length && HEX64.test(_ourPubkey));
  }

  function setTransports({ request, sign, publish, relays } = {}) {
    if (typeof request === 'function') _request = request;
    if (typeof sign === 'function') _sign = sign;
    if (typeof publish === 'function') _publish = publish;
    if (Array.isArray(relays)) _relays = relays;
  }

  function setOurPubkey(pk) {
    _ourPubkey = typeof pk === 'string' ? pk : '';
    if (!_ourPubkey) { _pending = null; _incoming = null; _armed = null; _acceptedTravellers.clear(); }
  }

  // requestTravel(world) — traveller: build + sign + publish a travel request to
  // `world` (a sanitised presence model from fetchOnlineWorlds). Stores it as
  // pending so tick() can watch for the host's accept. Returns { ok, error }.
  async function requestTravel(world) {
    _lastError = null;
    if (!_ready()) { _lastError = 'not-logged-in'; return { ok: false, error: _lastError }; }
    if (!world || typeof world.pubkey !== 'string' || !HEX64.test(world.pubkey)) {
      _lastError = 'bad-world'; return { ok: false, error: _lastError };
    }
    if (_armed) { return { ok: false, error: 'already-armed' }; }
    const built = buildTravelRequest({
      travellerPubkey: _ourPubkey,
      toHostPubkey: world.pubkey,
      toZone: world.zoneId || 'unknown',
      fromZone: 'quest-torii',
      playerNpub: world.npub || null,
      relays: _relays,
    });
    if (!built.ok) { _lastError = 'build-failed'; return { ok: false, error: _lastError }; }
    const signed = await _sign(built.event);
    if (!signed || !signed.ok || !signed.event || !signed.event.id) {
      _lastError = (signed && signed.error) || 'sign-failed'; return { ok: false, error: _lastError };
    }
    const pub = await _publish(_relays, signed.event, { timeoutMs: 5000 });
    if (!pub.accepted) { _lastError = 'publish-rejected'; return { ok: false, error: _lastError }; }
    _pending = {
      requestId: built.requestId,
      requestEventId: signed.event.id,
      hostPubkey: world.pubkey,
      toZone: world.zoneId || 'unknown',
      title: world.title || world.shortPubkey || world.zoneId || 'world',
    };
    return { ok: true, error: null };
  }

  // respondIncoming(accepted, { spawn }) — host: build + sign + publish an
  // accept/deny for the latest incoming request. Clears the incoming row.
  async function respondIncoming(accepted, extra = {}) {
    _lastError = null;
    if (!_ready()) { _lastError = 'not-logged-in'; return { ok: false, error: _lastError }; }
    if (!_incoming) { _lastError = 'no-incoming'; return { ok: false, error: _lastError }; }
    // P2: an ACCEPT crypto-gates the later seating. Verify the traveller's signed
    // request is genuinely from them and addressed to US before we commit to admit
    // them on arrival. A request that fails the schnorr check can still be DENIED,
    // but it can never be accepted into the seatable set (fail closed).
    if (accepted === true) {
      const v = verifyArrival({
        arrivingPubkey: _incoming.travellerPubkey,
        request: _incoming,
        expectedHostPubkey: _ourPubkey,
      });
      if (!v.seated) { _lastError = 'request-unverified'; return { ok: false, error: _lastError }; }
    }
    const built = buildTravelResponse({
      hostPubkey: _ourPubkey,
      request: _incoming,
      accepted: accepted === true,
      spawn: accepted ? (extra.spawn || 'https://quest-torii.pplx.app') : null,
      relays: _relays,
    });
    if (!built.ok) { _lastError = 'build-failed'; return { ok: false, error: _lastError }; }
    const signed = await _sign(built.event);
    if (!signed || !signed.ok || !signed.event) {
      _lastError = (signed && signed.error) || 'sign-failed'; return { ok: false, error: _lastError };
    }
    const pub = await _publish(_relays, signed.event, { timeoutMs: 5000 });
    if (!pub.accepted) { _lastError = 'publish-rejected'; return { ok: false, error: _lastError }; }
    // Record the crypto-verified accepted traveller so admitArrival can re-verify
    // and seat them when their browser lands on our spawn URL.
    if (accepted === true) _acceptedTravellers.set(_incoming.travellerPubkey, _incoming);
    _incoming = null;
    return { ok: true, error: null };
  }

  // admitArrival(url, opts?) → the host-side seating decision for an inbound hop.
  //   { ok, seated, npub, trust, anon, denied, error }. Never throws.
  // Reads the arriving npub from the spawn URL (`?torii-traveller=`), re-runs the
  // SEC-2 crypto verify against the traveller's signed request, then applies the
  // additive arrival-mode policy. In public mode, an unverified arrival stays anon;
  // in restricted modes, any miss (including follow-graph failure) DENIES.
  async function admitArrival(url, opts = {}) {
    const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
    const arriving = readArrivingTraveller(url);
    if (!arriving.ok) {
      return { ok: false, seated: false, npub: null, trust: 'unverified', anon: true, denied: false, error: arriving.error };
    }
    const injected = o.request;
    const request = (injected && typeof injected === 'object') ? injected : _acceptedTravellers.get(arriving.pubkey);
    const verdict = (!HEX64.test(_ourPubkey))
      ? { ok: true, seated: false, trust: 'unverified', npub: null, errors: ['no-host-identity'] }
      : (!request)
        ? { ok: true, seated: false, trust: 'unverified', npub: null, errors: ['no-verified-request'] }
        : verifyArrival({
          arrivingPubkey: arriving.pubkey,
          request,
          expectedHostPubkey: _ourPubkey,
        });
    return decideArrivalAdmission({
      verdict,
      ownerPubkey: _ourPubkey,
      arrivalMode: o.arrivalMode,
      followPolicy: o.followPolicy,
      request: _request,
      relays: _relays,
      timeoutMs: o.timeoutMs,
      graceMs: o.graceMs,
      retries: o.retries,
      cacheTtlMs: o.cacheTtlMs,
      nowMs: o.nowMs,
    });
  }

  function clearArmed() { _armed = null; }

  // tick() — one relay poll. Reads kind-30078 torii-gateway events addressed to us
  // (#p=[ourPubkey]), splits into incoming requests + responses, and:
  //   - traveller: if we have a pending request, look for an accept that verifies
  //     (SEC-2) → arm the hop + clear pending.
  //   - host: keep the latest incoming request surfaced (newest created_at wins).
  // Never throws; a failed poll is a no-op. Re-entrant-safe via _busy.
  async function tick() {
    if (!_ready() || _busy) return;
    _busy = true;
    try {
      const filter = buildGatewayFilter({ limit: 100 });
      filter['#p'] = [_ourPubkey]; // addressed-to-us: incoming requests + our accepts
      const raw = await _request(_relays, [filter], { timeoutMs: 5000, graceMs: 250, retries: 1 });
      const events = raw && Array.isArray(raw.events) ? raw.events : [];

      const reqs = readTravelRequests(events);
      if (reqs.count) {
        // Newest incoming request addressed to us as host.
        let newest = _incoming;
        for (const r of reqs.requests) {
          if (!newest || (r.created_at || 0) >= (newest.created_at || 0)) newest = r;
        }
        _incoming = newest;
      }

      if (_pending) {
        const resps = readTravelResponses(events);
        for (const resp of resps.responses) {
          if (!resp.accepted) continue;
          const v = verifyHandoff({
            response: resp,
            expectedRequestId: _pending.requestEventId,
            expectedHostPubkey: _pending.hostPubkey,
            expectedTravellerPubkey: _ourPubkey,
          });
          // S1 (v0.2.263): arm ONLY on a real BIP-340 crypto-verified accept.
          // A structural-only match no longer arms the hop.
          if (v.trusted && v.trust === 'crypto-verified') {
            _armed = {
              toZone: _pending.toZone,
              spawn: resp.spawn,
              hostPubkey: _pending.hostPubkey,
              title: _pending.title,
            };
            _pending = null;
            break;
          }
        }
      }
    } catch {
      // best-effort poll; never throw into the game loop
    } finally {
      _busy = false;
    }
  }

  // view() → a DOM-free view-model the host paints into the gateway card:
  //   { mode, badge, rows:[ [label,value] ], actions:[ 'accept'|'deny'|'jump'|'travel' ] }
  // mode ∈ 'offline' | 'scan' | 'pending' | 'incoming' | 'armed'.
  function view() {
    if (!_ourPubkey) {
      return { mode: 'scan', badge: 'LIVE · LOGIN TO TRAVEL', rows: [['SCAN', 'login to send/recv hops']], actions: [] };
    }
    if (_armed) {
      return {
        mode: 'armed', badge: 'LIVE · JUMP READY',
        rows: [
          ['HOST OK', _armed.title],
          ['DEST', _armed.toZone],
          ['SPAWN', _armed.spawn || '(same-origin)'],
        ],
        actions: ['jump'],
      };
    }
    if (_pending) {
      return {
        mode: 'pending', badge: 'LIVE · AWAITING HOST',
        rows: [
          ['TRAVEL', _pending.title],
          ['DEST', _pending.toZone],
          ['STATE', 'awaiting accept'],
        ],
        actions: [],
      };
    }
    if (_incoming) {
      return {
        mode: 'incoming', badge: 'LIVE · INCOMING REQUEST',
        rows: [
          ['FROM', _incoming.playerNpub || _incoming.travellerPubkey.slice(0, 12)],
          ['TO', _incoming.toZone || 'quest-torii'],
        ],
        actions: ['accept', 'deny'],
      };
    }
    return { mode: 'scan', badge: 'LIVE · HOST + TRAVELLER READY', rows: [['SCAN', 'click a world to travel']], actions: [] };
  }

  function snapshot() {
    return {
      ready: _ready(), ourPubkey: _ourPubkey,
      pending: _pending, incoming: _incoming, armed: _armed, lastError: _lastError,
    };
  }

  return {
    setTransports, setOurPubkey, requestTravel, respondIncoming, clearArmed,
    admitArrival, tick, view, snapshot,
  };
}
