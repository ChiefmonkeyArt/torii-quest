// tests/consent-gate.test.js — locks the CONSENT-GATE foundation
// (src/engine/consent/consentGate.js, CONSENT-1, v0.2.162). Proves the inert
// consent boundary: read-only actions are always allowed, write/sign/publish/
// update/travel actions are blocked unless an explicit MATCHING grant is present,
// malformed/unknown actions degrade safely, summaries are human-readable, and the
// gate exposes NO sign/publish/send/connect/submit surface and never performs an
// action. Pure module → node-testable.
import { describe, it, expect } from 'vitest';
import {
  CONSENT_GATE_VERSION, ACTION_KINDS, CONSENT_REASON, CONSENT_ACTIONS,
  isKnownAction, getActionDescriptor, isWriteAction,
  buildConsentRequest, summariseConsent, evaluateConsent, requestConsent,
} from '../src/engine/consent/consentGate.js';
import * as SDK from '../src/sdk/index.js';

describe('registry + descriptors', () => {
  it('exposes the documented action ids with consistent flags', () => {
    expect(isKnownAction('nostr:publish')).toBe(true);
    expect(isKnownAction('leaderboard:read')).toBe(true);
    expect(isKnownAction('nope:nope')).toBe(false);
    expect(getActionDescriptor('nope')).toBeNull();

    for (const [id, d] of Object.entries(CONSENT_ACTIONS)) {
      expect(d.id).toBe(id);
      expect(ACTION_KINDS).toContain(d.kind);
      // read is the only inert kind; everything else needs consent.
      expect(d.requiresConsent).toBe(d.kind !== 'read');
      expect(typeof d.summary).toBe('string');
    }
  });

  it('classifies read vs write actions', () => {
    expect(isWriteAction('leaderboard:read')).toBe(false);
    expect(isWriteAction('profile:read')).toBe(false);
    expect(isWriteAction('relay:read')).toBe(false);
    expect(isWriteAction('nostr:publish')).toBe(true);
    expect(isWriteAction('profile:update')).toBe(true);
    expect(isWriteAction('leaderboard:submit')).toBe(true);
    expect(isWriteAction('update:apply')).toBe(true);
    expect(isWriteAction('gateway:travel')).toBe(true);
    expect(isWriteAction('unknown')).toBe(false);
  });
});

describe('buildConsentRequest', () => {
  it('builds a flat request from an id or an object', () => {
    const a = buildConsentRequest('nostr:publish');
    expect(a.ok).toBe(true);
    expect(a.request.action).toBe('nostr:publish');
    expect(a.request.write).toBe(true);
    expect(a.request.signed).toBe(true);
    expect(a.request.requiresConsent).toBe(true);

    const b = buildConsentRequest({ action: 'leaderboard:submit', detail: { score: 240 }, origin: 'hud' });
    expect(b.ok).toBe(true);
    expect(b.request.detail).toEqual({ score: 240 });
    expect(b.request.origin).toBe('hud');
  });

  it('degrades unknown/malformed actions without throwing', () => {
    expect(buildConsentRequest('does:not:exist').ok).toBe(false);
    expect(buildConsentRequest({ action: 42 }).ok).toBe(false);
    expect(buildConsentRequest(null).ok).toBe(false);
    expect(buildConsentRequest([]).ok).toBe(false);
  });
});

describe('summariseConsent', () => {
  it('reads READ for safe actions and tags consent-required ones', () => {
    expect(summariseConsent('profile:read')).toMatch(/^READ · /);
    const s = summariseConsent('nostr:publish');
    expect(s).toContain('PUBLISH');
    expect(s).toContain('requires explicit consent');
    expect(s.startsWith('⚠ ')).toBe(true); // high danger marker
  });

  it('returns a safe label for unknown actions', () => {
    expect(summariseConsent('bogus')).toBe('Unknown action — blocked.');
  });
});

describe('evaluateConsent — read-only tier', () => {
  it('always allows read actions and ignores the grant', () => {
    const d = evaluateConsent('leaderboard:read');
    expect(d.allowed).toBe(true);
    expect(d.blocked).toBe(false);
    expect(d.reason).toBe(CONSENT_REASON.READ_ONLY);
    expect(d.performed).toBe(false);
    // Even a falsy grant cannot block a read.
    expect(evaluateConsent('profile:read', false).allowed).toBe(true);
  });
});

describe('evaluateConsent — write tier', () => {
  it('blocks a write action with no grant', () => {
    const d = evaluateConsent('nostr:publish');
    expect(d.allowed).toBe(false);
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe(CONSENT_REASON.CONSENT_REQUIRED);
    expect(d.performed).toBe(false);
  });

  it('allows a write action only with an explicit grant (boolean true)', () => {
    const d = evaluateConsent('leaderboard:submit', true);
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe(CONSENT_REASON.CONSENT_GRANTED);
  });

  it('allows with a scoped { granted, action } token that matches', () => {
    const d = evaluateConsent('profile:update', { granted: true, action: 'profile:update', token: 'abc' });
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe(CONSENT_REASON.CONSENT_GRANTED);
  });

  it('blocks a grant minted for a DIFFERENT action (no privilege transfer)', () => {
    const d = evaluateConsent('nostr:publish', { granted: true, action: 'gateway:travel' });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe(CONSENT_REASON.CONSENT_MISMATCH);
  });

  it('blocks an un-granted token ({ granted:false })', () => {
    const d = evaluateConsent('update:apply', { granted: false });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe(CONSENT_REASON.CONSENT_REQUIRED);
  });
});

describe('evaluateConsent — malformed / unknown', () => {
  it('blocks unknown actions and never throws', () => {
    const d = evaluateConsent('totally:made:up', true);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe(CONSENT_REASON.UNKNOWN_ACTION);
    expect(d.action).toBeNull();
  });

  it('blocks malformed input shapes', () => {
    expect(evaluateConsent(null, true).reason).toBe(CONSENT_REASON.MALFORMED);
    expect(evaluateConsent(42, true).allowed).toBe(false);
    expect(evaluateConsent(42, true).reason).toBe(CONSENT_REASON.MALFORMED);
    expect(evaluateConsent({ action: 7 }, true).allowed).toBe(false);
  });
});

describe('requestConsent — combined report', () => {
  it('folds build + evaluate + summary for a write action', () => {
    const r = requestConsent('leaderboard:submit', true);
    expect(r.ok).toBe(true);
    expect(r.request.action).toBe('leaderboard:submit');
    expect(r.decision.allowed).toBe(true);
    expect(r.summary).toContain('PUBLISH');
  });

  it('reports ok:false for an unknown action but still returns an inert blocked decision', () => {
    const r = requestConsent('nope', true);
    expect(r.ok).toBe(false);
    expect(r.request).toBeNull();
    expect(r.decision.allowed).toBe(false);
    expect(r.decision.performed).toBe(false);
  });
});

describe('inertness invariants', () => {
  it('exposes NO action-performing methods on the module surface', () => {
    const mod = SDK.consentGate;
    for (const key of ['sign', 'publish', 'send', 'connect', 'submit', 'apply', 'travel', 'write']) {
      expect(typeof mod[key]).not.toBe('function');
    }
  });

  it('every decision pins performed:false and readOnly:true', () => {
    for (const id of Object.keys(CONSENT_ACTIONS)) {
      const d = evaluateConsent(id, true);
      expect(d.performed).toBe(false);
      expect(d.readOnly).toBe(true);
    }
  });
});

describe('SDK exposure', () => {
  it('exposes consentGate at the experimental SDK tier', () => {
    expect(SDK.SDK_SURFACE.consentGate.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
    expect(typeof SDK.consentGate.evaluateConsent).toBe('function');
    expect(typeof SDK.consentGate.buildConsentRequest).toBe('function');
    expect(SDK.consentGate.CONSENT_GATE_VERSION).toBe(CONSENT_GATE_VERSION);
  });
});
