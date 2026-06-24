// engine/consent/consentGate.js — CONSENT-GATE foundation (CONSENT-1, v0.2.162).
// An explicit, auditable consent boundary that future Nostr signing/publishing,
// profile publish, leaderboard submit, gateway travel, and update-apply actions
// MUST pass through before they may ever touch the wire. This module decides — in
// a pure, testable way — whether a requested action is read-only (always allowed)
// or a write/sign/publish/update/travel action (blocked unless the caller presents
// an explicit, matching consent grant). It is the gate; it is NOT the door.
//
// Pure + node-safe: NO Nostr client, NO WebSocket, NO relay I/O, NO signing, NO
// publishing, NO NIP-07, NO key handling, NO payments, NO DOM, NO network, NO
// auto-update, NO navigation. This module NEVER performs an action — it only shapes
// a consent request and returns an INERT allowed/blocked DECISION. It exposes NO
// sign/publish/send/connect/submit/apply/travel method; a decision of `allowed:true`
// is permission for the HOST to act later behind its own audited transport, never an
// action taken here. Every helper degrades safely on malformed input and never
// throws. (The nostrich write path — NIP-07 signer + relay publish, SEC-1 — is the
// deferred next step that will consume these decisions.)

// CONSENT_GATE_VERSION — bumped when the descriptor/decision shape changes.
export const CONSENT_GATE_VERSION = 1;

// The kinds of action the gate understands. `read` is the only inert kind; every
// other kind mutates external state, requires a signature, or leaves the world.
export const ACTION_KINDS = Object.freeze([
  'read', 'write', 'sign', 'publish', 'update', 'travel',
]);

// Decision reason codes — why an action was allowed or blocked. Stable strings so
// tests + a future audit log can assert on them.
export const CONSENT_REASON = Object.freeze({
  READ_ONLY: 'read-only',           // allowed — no consent needed
  CONSENT_GRANTED: 'consent-granted', // allowed — explicit matching grant present
  CONSENT_REQUIRED: 'consent-required', // blocked — write action, no grant
  CONSENT_MISMATCH: 'consent-mismatch', // blocked — grant is for a different action
  UNKNOWN_ACTION: 'unknown-action', // blocked — not in the registry
  MALFORMED: 'malformed',           // blocked — unusable request/grant shape
});

// The known-action registry. Each descriptor is a plain, frozen data record:
//   id              stable 'domain:verb' identifier
//   kind            one of ACTION_KINDS
//   label           short human-facing action name
//   write           true if it mutates state outside this client
//   signed          true if it needs a cryptographic signature (NIP-07)
//   requiresConsent true if it must present an explicit grant to proceed
//   danger          'low' | 'high' — how much a mistaken grant could cost
//   summary         one-line user-facing description of what WOULD happen
//
// Read-only actions (requiresConsent:false) are the foundation's "safe" tier — they
// exist so callers can route reads through the same gate and get a uniform decision.
function _action(id, kind, label, { write, signed, danger, summary }) {
  return Object.freeze({
    id,
    kind,
    label,
    write: !!write,
    signed: !!signed,
    // Anything that writes, signs, leaves the world, or applies an update needs an
    // explicit grant; pure reads never do.
    requiresConsent: kind !== 'read',
    danger: danger || (kind === 'read' ? 'low' : 'high'),
    summary,
  });
}

export const CONSENT_ACTIONS = Object.freeze({
  // --- Read-only tier (always allowed, no grant needed) --------------------
  'leaderboard:read': _action('leaderboard:read', 'read', 'Read the leaderboard',
    { write: false, signed: false, danger: 'low', summary: 'Read ranked scores from relays. No write, no signature.' }),
  'profile:read': _action('profile:read', 'read', 'Read a profile',
    { write: false, signed: false, danger: 'low', summary: 'Read kind:0 profile metadata from relays. No write, no signature.' }),
  'relay:read': _action('relay:read', 'read', 'Read relay events',
    { write: false, signed: false, danger: 'low', summary: 'Read events from a relay via an injected read-only transport. No write.' }),

  // --- Write / sign / publish / update / travel tier (grant required) ------
  'nostr:publish': _action('nostr:publish', 'publish', 'Publish a Nostr event',
    { write: true, signed: true, danger: 'high', summary: 'Sign and publish a Nostr event to relays. Requires your explicit consent.' }),
  'profile:update': _action('profile:update', 'update', 'Update your profile',
    { write: true, signed: true, danger: 'high', summary: 'Sign and publish a new kind:0 profile, replacing your current one. Requires your explicit consent.' }),
  'leaderboard:submit': _action('leaderboard:submit', 'publish', 'Submit a score',
    { write: true, signed: true, danger: 'high', summary: 'Sign and publish a kind-30000 score event to the leaderboard. Requires your explicit consent.' }),
  'update:apply': _action('update:apply', 'update', 'Apply an update',
    { write: true, signed: false, danger: 'high', summary: 'Apply a torii.quest update. Manual + maintainer-gated; requires your explicit consent.' }),
  'gateway:travel': _action('gateway:travel', 'travel', 'Travel through a gateway',
    { write: false, signed: false, danger: 'high', summary: 'Leave this world and travel to another via a gateway. Requires your explicit consent.' }),
});

// isKnownAction(id) → true when `id` is a registered action.
export function isKnownAction(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(CONSENT_ACTIONS, id);
}

// getActionDescriptor(id) → the frozen descriptor, or null when unknown.
export function getActionDescriptor(id) {
  return isKnownAction(id) ? CONSENT_ACTIONS[id] : null;
}

// isWriteAction(id) → true when the action mutates external state, signs, publishes,
// updates, or travels (i.e. anything that is not a pure read). Unknown → false.
export function isWriteAction(id) {
  const d = getActionDescriptor(id);
  return d ? d.requiresConsent : false;
}

// _plainObject(v) → true for a non-null, non-array object.
function _plainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// buildConsentRequest(input) → { ok, request?|errors? }. Pure, never throws.
// `input` is an action id string OR `{ action, detail?, origin? }`. The result is a
// flat consent-request descriptor that pins the action's write/sign/danger facts
// alongside any caller-supplied `detail` (free-form, e.g. the score or npub) and
// `origin` (who is asking). Unknown/malformed actions degrade to ok:false.
export function buildConsentRequest(input) {
  const raw = typeof input === 'string' ? { action: input } : input;
  if (!_plainObject(raw)) {
    return { ok: false, errors: ['request must be an action id or { action } object'] };
  }
  const { action, detail = null, origin = null } = raw;
  const descriptor = getActionDescriptor(action);
  if (!descriptor) {
    return { ok: false, errors: [`unknown action: ${typeof action === 'string' ? action : typeof action}`] };
  }
  const request = {
    action: descriptor.id,
    kind: descriptor.kind,
    label: descriptor.label,
    write: descriptor.write,
    signed: descriptor.signed,
    requiresConsent: descriptor.requiresConsent,
    danger: descriptor.danger,
    summary: descriptor.summary,
    detail,
    origin: typeof origin === 'string' && origin !== '' ? origin : null,
  };
  return { ok: true, request };
}

// summariseConsent(input) → a single human-readable line for a confirm prompt / HUD
// row / audit log. Pure, never throws. Accepts a request object or an action id.
// Read-only actions read "READ"; consent-required actions are tagged with their kind
// and a "(requires explicit consent)" suffix so the stakes are never hidden.
export function summariseConsent(input) {
  const built = (input && input.action && input.summary) ? { ok: true, request: input } : buildConsentRequest(input);
  if (!built.ok) return 'Unknown action — blocked.';
  const r = built.request;
  const tag = r.requiresConsent ? r.kind.toUpperCase() : 'READ';
  const dangerMark = r.danger === 'high' ? '⚠ ' : '';
  const suffix = r.requiresConsent ? ' (requires explicit consent)' : '';
  return `${dangerMark}${tag} · ${r.label} — ${r.summary}${suffix}`;
}

// _grantMatches(grant, actionId) → true when `grant` explicitly authorises THIS
// action. A grant is `true` (a blanket flag for this single evaluated action) or
// `{ granted:true, action?, token? }`. When `grant.action` is present it MUST equal
// `actionId` — a grant minted for one action can never authorise another. Any other
// shape (false, null, missing) is treated as no grant.
function _grantState(grant, actionId) {
  if (grant === true) return { granted: true, mismatch: false };
  if (_plainObject(grant)) {
    const granted = grant.granted === true;
    if (!granted) return { granted: false, mismatch: false };
    // A scoped grant must match the action it is being applied to.
    if (typeof grant.action === 'string' && grant.action !== actionId) {
      return { granted: false, mismatch: true };
    }
    return { granted: true, mismatch: false };
  }
  return { granted: false, mismatch: false };
}

// evaluateConsent(input, grant) → an INERT decision. Pure, never throws, NEVER acts.
//
//   {
//     action:          id|null,
//     allowed:         boolean,   // host MAY proceed (behind its own transport)
//     blocked:         boolean,   // = !allowed
//     reason:          CONSENT_REASON.*,
//     requiresConsent: boolean,
//     write:           boolean,
//     signed:          boolean,
//     danger:          'low'|'high',
//     summary:         string,
//     performed:       false,     // ALWAYS — this gate never performs the action
//     readOnly:        true,      // the gate itself is inert
//     errors:          [string],
//   }
//
// Decision rules:
//   - malformed/unknown action      → blocked (MALFORMED / UNKNOWN_ACTION)
//   - read-only action               → allowed (READ_ONLY), grant ignored
//   - write action + matching grant  → allowed (CONSENT_GRANTED)
//   - write action + no grant         → blocked (CONSENT_REQUIRED)
//   - write action + wrong-action grant → blocked (CONSENT_MISMATCH)
export function evaluateConsent(input, grant = null) {
  const built = (input && input.action && input.summary && 'requiresConsent' in input)
    ? { ok: true, request: input }
    : buildConsentRequest(input);

  const base = {
    action: null,
    allowed: false,
    blocked: true,
    reason: CONSENT_REASON.MALFORMED,
    requiresConsent: true,
    write: false,
    signed: false,
    danger: 'high',
    summary: '',
    performed: false,
    readOnly: true,
    errors: [],
  };

  if (!built.ok) {
    const unknown = built.errors && built.errors.some((e) => e.startsWith('unknown action'));
    return { ...base, reason: unknown ? CONSENT_REASON.UNKNOWN_ACTION : CONSENT_REASON.MALFORMED, errors: built.errors || ['malformed request'] };
  }

  const r = built.request;
  const decision = {
    ...base,
    action: r.action,
    requiresConsent: r.requiresConsent,
    write: r.write,
    signed: r.signed,
    danger: r.danger,
    summary: r.summary,
  };

  if (!r.requiresConsent) {
    return { ...decision, allowed: true, blocked: false, reason: CONSENT_REASON.READ_ONLY };
  }

  const { granted, mismatch } = _grantState(grant, r.action);
  if (granted) {
    return { ...decision, allowed: true, blocked: false, reason: CONSENT_REASON.CONSENT_GRANTED };
  }
  return {
    ...decision,
    allowed: false,
    blocked: true,
    reason: mismatch ? CONSENT_REASON.CONSENT_MISMATCH : CONSENT_REASON.CONSENT_REQUIRED,
  };
}

// requestConsent(input, grant) → { ok, request?, decision, summary }. A convenience
// that folds buildConsentRequest + evaluateConsent + summariseConsent into one
// read-only report for a HOST consent prompt. Pure, never throws, never acts. `ok`
// mirrors whether the request itself was well-formed (NOT whether it was allowed).
export function requestConsent(input, grant = null) {
  const built = buildConsentRequest(input);
  const decision = evaluateConsent(built.ok ? built.request : input, grant);
  return {
    ok: built.ok,
    request: built.ok ? built.request : null,
    decision,
    summary: built.ok ? summariseConsent(built.request) : 'Unknown action — blocked.',
    errors: built.ok ? [] : (built.errors || []),
  };
}
