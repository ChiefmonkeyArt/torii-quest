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
// SEC-1 gate (v0.2.256): if a `gate` verifier is provided, publishScore runs it
// AFTER signing and BEFORE any relay publish. A gate failure blocks the publish
// (published stays false, errors captured) — the signed event is never handed to
// `publish()`. Without a gate the behaviour is unchanged (backward compatible);
// any future LIVE-publish wiring MUST pass `gate: verifyPublishGate` + a
// `{ signerPubkey, consent }` ctx so a relay write can never run ungated.
export function createLeaderboardPublisher({ sign = null, publish = null, gate = null } = {}) {
  // publishScore(stats, ctx) → { ok, template, signed, event, published, errors }.
  //   - always: template = the unsigned kind-30000 event template.
  //   - no signer:        signed=false, published=false (caller signs elsewhere).
  //   - signer only:      signed=true, event=signed, published=false.
  //   - signer+publisher: published=true once publish() resolves.
  //   - ctx (optional): { signerPubkey, consent } forwarded to the SEC-1 gate when
  //     a gate verifier is wired. Without a gate, ctx is ignored.
  async function publishScore(stats = {}, ctx = {}) {
    const template = buildScoreEventTemplate(stats); // throws on invalid score
    const result = {
      ok: true, template, signed: false, event: null, published: false, errors: [],
    };

    if (typeof sign !== 'function') return result;        // build-only path

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
    // failure fails closed — publish() is never called.
    if (typeof gate === 'function') {
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
