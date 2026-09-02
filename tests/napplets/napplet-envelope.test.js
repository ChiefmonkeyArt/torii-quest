// tests/napplets/napplet-envelope.test.js — pure contract for the NIP-5D-style
// postMessage envelope helpers (ADR-0057). No DOM, no network.
import { describe, it, expect } from 'vitest';
import {
  WORLD_NAMESPACE, splitType, validateEnvelope,
  resultEnvelope, errorEnvelope, isResultType, isErrorType,
} from '../../src/engine/napplets/nappletEnvelope.js';

describe('splitType', () => {
  it('splits a dotted namespace type into ns + action', () => {
    expect(splitType('world.attach.get')).toEqual({ ns: 'world', action: 'attach.get' });
  });
  it('returns null for a bare string with no dot', () => {
    expect(splitType('world')).toBeNull();
  });
  it('returns null for non-string / empty', () => {
    expect(splitType(null)).toBeNull();
    expect(splitType('')).toBeNull();
    expect(splitType(42)).toBeNull();
  });
});

describe('validateEnvelope', () => {
  it('accepts a well-formed request', () => {
    expect(validateEnvelope({ type: 'world.attach.get', id: 'r1', data: {} })).toEqual(
      { ok: true, type: 'world.attach.get', id: 'r1', data: {} },
    );
  });
  it('defaults missing data to an empty object', () => {
    const v = validateEnvelope({ type: 'world.emit', id: 'r2' });
    expect(v.ok).toBe(true);
    expect(v.data).toEqual({});
  });
  it('accepts numeric ids (opaque to the shell)', () => {
    expect(validateEnvelope({ type: 'world.zone.list', id: 7, data: {} }).ok).toBe(true);
  });
  it('rejects non-object messages', () => {
    expect(validateEnvelope(null).ok).toBe(false);
    expect(validateEnvelope('world.attach.get').ok).toBe(false);
  });
  it('rejects missing or malformed type', () => {
    expect(validateEnvelope({ id: 'r1' }).reason).toBe('missing-type');
    expect(validateEnvelope({ type: 'notype', id: 'r1' }).reason).toBe('malformed-type');
  });
  it('rejects missing id', () => {
    expect(validateEnvelope({ type: 'world.emit', data: {} }).reason).toBe('missing-id');
  });
  it('rejects non-object data', () => {
    expect(validateEnvelope({ type: 'world.emit', id: 'r1', data: 'no' }).reason).toBe('bad-data');
  });
});

describe('result / error envelopes', () => {
  it('resultEnvelope appends .result and carries the id', () => {
    expect(resultEnvelope('world.attach.get', 'r1', { zoneId: 'nap' })).toEqual(
      { type: 'world.attach.get.result', id: 'r1', result: { zoneId: 'nap' } },
    );
  });
  it('errorEnvelope carries a code + message', () => {
    expect(errorEnvelope('world.emit', 'r2', 'wrong-surface', 'no')).toEqual(
      { type: 'world.emit.error', id: 'r2', error: { code: 'wrong-surface', message: 'no' } },
    );
  });
});

describe('isResultType / isErrorType', () => {
  it('recognizes result and error type suffixes', () => {
    expect(isResultType('world.attach.get.result')).toBe(true);
    expect(isErrorType('world.emit.error')).toBe(true);
    expect(isResultType('world.attach.get')).toBe(false);
    expect(isErrorType('world.attach.get.result')).toBe(false);
  });
});

describe('WORLD_NAMESPACE', () => {
  it('is the world namespace string', () => {
    expect(WORLD_NAMESPACE).toBe('world');
  });
});
