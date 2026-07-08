// engine/nostr/leaderboardPublisher.js — leaderboard publisher ADAPTER shape
// (LB-1 continuation, v0.2.135). Defines the boundary between the pure score
// template (leaderboard.js) and the host's signing/relay layer, WITHOUT pulling
// either into this module.
//
// Pure + node-safe: NO Nostr client, NO relay I/O, NO key handling, NO secrets.
// The signer and publisher are INJECTED dependencies — this module never holds a
// private key and never opens a socket. With no signer it just hands back the
// unsigned template; with an injected signer it returns a signed-ready event;
// only an injected publisher actually ships it. Default behaviour is "build, do
// not publish", so importing this module can never put a score on a relay.
//
//   signer:    (template) => signedEvent            (sync or async)
//   publisher: (signedEvent) => any                 (sync or async)

import { buildScoreEventTemplate } from './leaderboard.js';
import { verifyPublishGate } from '../leaderboard/publishGate.js';

// createLeaderboardPublisher({ sign, publish, gate }) → { publishScore }. Both deps
// are optional. `publishScore(stats)` is async and returns a structured result; it
// NEVER throws on a signer/publisher failure (the error is captured in the
// result) — only buildScoreEventTemplate throws, on an invalid score, before any
// signing is attempted.
//
// SEC-1 gate (v0.2.256; hardened v0.2.355): the signed event must clear a real
// gate verifier BEFORE any relay publish. A gate failure fails closed — the
// signed event is never handed to `publish()`. From v0.2.355 the gate is a HARD
// requirement whenever a `publish` function is wired:
//
//   - `gate` DEFAULTS to `verifyPublishGate` (the crypto-verified SEC-1 gate),
//     so any live publisher inherits real BIP-340 verification + the consent
//     check by default. This removes the earlier "backward compatible" bypass
//     where a caller could wire `{ sign, publish }` and quietly ship stub or
//     unverified events to a relay.
//   - An explicit `gate: null` is treated as a SEC-1 CONSTRUCTION ERROR when
//     `publish` is also wired: publishScore fails closed on every call, never
//     signs, never publishes. Callers who genuinely want an ungated path must
//     leave `publish` unset (build-only) instead.
//   - The build-only path (`publish===null`) still needs no gate — it never
//     writes a byte to a relay.
export function createLeaderboardPublisher(opts = {}) {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const sign = typeof o.sign === 'function' ? o.sign : null;
  const publish = typeof o.publish === 'function' ? o.publish : null;
  // Default `gate` to the crypto-verified SEC-1 gate; only an EXPLICIT `gate: null`
  // opts out (and, per the invariant below, is refused whenever publish is wired).
  const gate = ('gate' in o)
    ? (typeof o.gate === 'function' ? o.gate : null)
    : verifyPublishGate;

  // SEC-1 construction invariant: publish without gate is fail-closed. Captured
  // once at construction so every publishScore call reports the same block
  // reason rather than silently accepting a relay write.
  const _sec1MissingGate = publish !== null && gate === null;

  // publishScore(stats, ctx) → { ok, template, signed, event, published, errors }.
  //   - always: template = the unsigned kind-30000 event template.
  //   - no signer:        signed=false, published=false (caller signs elsewhere).
  //   - signer only:      signed=true, event=signed, published=false.
  //   - signer+publisher: published=true once publish() resolves AND the gate
  //                       returns trusted:true.
  //   - signer+publisher+explicit `gate: null`: FAIL CLOSED (SEC-1) — never
  //                       signs, never publishes; ok=false with a SEC-1-gate-
  //                       missing error.
  //   - ctx: { signerPubkey, consent } is forwarded to the gate (both required
  //     for a trusted verdict from the default verifyPublishGate).
  async function publishScore(stats = {}, ctx = {}) {
    const template = buildScoreEventTemplate(stats); // throws on invalid score
    const result = {
      ok: true, template, signed: false, event: null, published: false, errors: [],
    };

    // SEC-1 (v0.2.355): a live publisher without a gate is refused BEFORE any
    // signing so a signed event is never even produced. Fail closed.
    if (_sec1MissingGate) {
      result.ok = false;
      result.errors.push('SEC-1: publish is wired without a gate — refusing to sign (fail closed)');
      return result;
    }

    if (sign === null) return result;                     // build-only path

    try {
      result.event = await sign(template);
      result.signed = true;
    } catch (e) {
      result.ok = false;
      result.errors.push('sign failed: ' + (e?.message || String(e)));
      return result;
    }

    if (typeof publish !== 'function') return result;     // signed, not shipped

    // SEC-1: the signed event must clear the gate BEFORE the relay write. A gate
    // failure fails closed — publish() is never called. `gate` is guaranteed to
    // be a function here (the _sec1MissingGate guard above refused publish + no
    // gate up front), so this branch is not optional at runtime.
    const c = ctx && typeof ctx === 'object' && !Array.isArray(ctx) ? ctx : {};
    const verdict = gate(result.event, {
      expectedSignerPubkey: c.signerPubkey || null,
      consent: c.consent === true,
    });
    if (!verdict || verdict.trusted !== true) {
      result.ok = false;
      result.errors.push('SEC-1 gate blocked publish: ' + ((verdict && verdict.errors) || []).join('; '));
      return result;
    }

    try {
      await publish(result.event);
      result.published = true;
    } catch (e) {
      result.ok = false;
      result.errors.push('publish failed: ' + (e?.message || String(e)));
    }
    return result;
  }

  return { publishScore };
}
