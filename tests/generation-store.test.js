// tests/generation-store.test.js — locks the durable paid-generation job store
// (audit F02). The store replaces the transient in-memory pendingGenerations Map
// with a bounded state machine (pending → claimed → completed|retryable) persisted
// to a JSON snapshot, so a restart cannot strand a payer, an atomic claim cannot
// double-spend the operator's Meshy credits, and a failed generation is retryable
// without re-charge. Tests use a real node:fs + a scratch tmpdir so the atomic
// write-temp-then-rename persistence is exercised, not a stub.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeGenerationStore, GEN_STATES } from '../server/character/generationStore.js';
import { createConcurrencyGate } from '../server/character/concurrencyGate.js';

let dir;
let filePath;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gen-store-'));
  filePath = join(dir, 'mesh-gen-store.json');
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function createPending(s, id = 'a', pubkey = 'pk') {
  s.create({ generationId: id, prompt: 'p', invoice: 'lnbc1', verifyUrl: null, pubkey });
}

describe('durability (JSON snapshot, atomic rename)', () => {
  it('persists a created record and reloads it across a restart', () => {
    const s1 = makeGenerationStore({ filePath });
    createPending(s1);
    const s2 = makeGenerationStore({ filePath }); // fresh instance = simulated restart
    const rec = s2.get('a');
    expect(rec).toBeTruthy();
    expect(rec.state).toBe(GEN_STATES.PENDING);
    expect(rec.prompt).toBe('p');
    expect(rec.invoice).toBe('lnbc1');
  });

  it('persists state transitions so a claimed/retryable entry survives a restart', () => {
    const s1 = makeGenerationStore({ filePath });
    createPending(s1);
    s1.claim('a');
    s1.fail('a', 'boom');
    const s2 = makeGenerationStore({ filePath });
    expect(s2.get('a').state).toBe(GEN_STATES.RETRYABLE);
    expect(s2.get('a').error).toBe('boom');
  });

  it('writes atomically (tmp then rename) and never leaves a half-written snapshot', () => {
    const s = makeGenerationStore({ filePath });
    createPending(s);
    // The real file exists and is valid JSON; the .tmp is renamed away.
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toHaveProperty('a');
    expect(readFileSync(filePath, 'utf8')).not.toContain('}\nundefined');
  });

  it('starts empty + non-crashing on a corrupt snapshot', () => {
    writeFileSync(filePath, '{ not json', 'utf8');
    const s = makeGenerationStore({ filePath });
    expect(s.size()).toBe(0);
  });
});

describe('atomic claim (no double-spend)', () => {
  it('claims pending → claimed, then a second claim fails', () => {
    const s = makeGenerationStore({ filePath });
    createPending(s);
    expect(s.claim('a')).toBeTruthy();
    expect(s.get('a').state).toBe(GEN_STATES.CLAIMED);
    expect(s.claim('a')).toBeNull(); // the concurrent confirm loses
  });

  it('claims retryable → claimed (re-confirm without re-charge)', () => {
    const s = makeGenerationStore({ filePath });
    createPending(s);
    s.claim('a');
    s.fail('a', 'upstream 500');
    expect(s.get('a').state).toBe(GEN_STATES.RETRYABLE);
    expect(s.claim('a')).toBeTruthy();
    expect(s.get('a').state).toBe(GEN_STATES.CLAIMED);
  });

  it('never claims a completed record (idempotent re-confirm is a read)', () => {
    const s = makeGenerationStore({ filePath });
    createPending(s);
    s.claim('a');
    s.complete('a', 'https://cdn/mesh.glb');
    expect(s.claim('a')).toBeNull();
    expect(s.get('a').glbUrl).toBe('https://cdn/mesh.glb');
  });

  it('never claims a missing record', () => {
    const s = makeGenerationStore({ filePath });
    expect(s.claim('nope')).toBeNull();
  });
});

describe('complete / fail', () => {
  it('complete caches the glbUrl only from the claimed state', () => {
    const s = makeGenerationStore({ filePath });
    createPending(s);
    expect(s.complete('a', 'url')).toBe(false); // not claimed yet
    s.claim('a');
    expect(s.complete('a', 'url')).toBe(true);
    expect(s.get('a').state).toBe(GEN_STATES.COMPLETED);
    expect(s.get('a').glbUrl).toBe('url');
  });

  it('fail marks claimed → retryable and keeps the settled invoice', () => {
    const s = makeGenerationStore({ filePath });
    createPending(s);
    s.claim('a');
    expect(s.fail('a', 'meshy error')).toBe(true);
    const rec = s.get('a');
    expect(rec.state).toBe(GEN_STATES.RETRYABLE);
    expect(rec.error).toBe('meshy error');
    expect(rec.invoice).toBe('lnbc1'); // retained → retry re-verifies, no re-pay
  });
});

describe('sweep bounds memory but never strands a payer', () => {
  it('sweeps only expired pending entries', () => {
    const s = makeGenerationStore({ filePath, pendingTtlMs: 10 });
    createPending(s, 'a');
    // a second pending created "later" is outside the window only if expired
    const s2 = makeGenerationStore({ filePath, pendingTtlMs: 10 });
    createPending(s2, 'b');
    // simulate time passing past the pending TTL
    const removed = s2.sweep(Date.now() + 1000);
    expect(removed).toBe(2); // both pending are now stale
    expect(s2.get('a')).toBeNull();
    expect(s2.get('b')).toBeNull();
  });

  it('retains a paid (completed) entry past the pending TTL', () => {
    const s = makeGenerationStore({ filePath, pendingTtlMs: 1 });
    createPending(s);
    s.claim('a');
    s.complete('a', 'url');
    s.sweep(Date.now() + 1000); // far past the pending TTL
    expect(s.get('a')).toBeTruthy(); // completed is never pending-swept
  });

  it('drops a completed entry only after the settled TTL', () => {
    // settledTtlMs is large and the sweep `now` offsets are explicit + generous,
    // so the test never flips on a slow CI machine (the store stamps settledAt
    // from the real clock, so a 50 ms window was timing-fragile here).
    const s = makeGenerationStore({ filePath, settledTtlMs: 60_000 });
    createPending(s);
    s.claim('a');
    s.complete('a', 'url');
    s.sweep(Date.now() + 10_000); // within settled window (10s < 60s)
    expect(s.get('a')).toBeTruthy();
    s.sweep(Date.now() + 120_000); // past settled window (120s > 60s)
    expect(s.get('a')).toBeNull();
  });

  it('sweep persists the removal (survives restart)', () => {
    const s = makeGenerationStore({ filePath, pendingTtlMs: 1 });
    createPending(s);
    s.sweep(Date.now() + 1000);
    expect(makeGenerationStore({ filePath }).size()).toBe(0);
  });
});

describe('create bounds the pending volume without evicting paid entries', () => {
  it('evicts the oldest PENDING entry at the cap, never a paid one', () => {
    const s = makeGenerationStore({ filePath, maxPending: 2 });
    createPending(s, 'a');
    s.claim('a');            // 'a' is now paid (claimed) — must never be evicted
    createPending(s, 'b');
    createPending(s, 'c');   // pending [b, c] reaches the cap — no eviction yet
    createPending(s, 'd');   // cap hit → evict the OLDEST still-pending entry (b)
    expect(s.get('a')).toBeTruthy(); // claimed survives
    expect(s.get('b')).toBeNull();   // oldest PENDING evicted
    expect(s.get('c')).toBeTruthy();
    expect(s.get('d')).toBeTruthy();
    expect(s.size()).toBe(3);        // a (claimed) + c + d
  });
});

describe('arena-ws wiring (source-level lock)', () => {
  const arena = readFileSync(new URL('../server/arena-ws.js', import.meta.url), 'utf8');

  it('no longer holds a transient pendingGenerations Map', () => {
    expect(arena).not.toMatch(/pendingGenerations\s*=\s*new Map/);
    expect(arena).not.toMatch(/MAX_PENDING_GENERATIONS/);
  });

  it('confirm uses the atomic claim + completed/retryable state machine', () => {
    expect(arena).toMatch(/generationStore\.claim\(generationId\)/);
    expect(arena).toMatch(/generationStore\.complete\(generationId, glbUrl\)/);
    expect(arena).toMatch(/generationStore\.fail\(generationId/);
    expect(arena).toMatch(/GEN_STATES\.COMPLETED/);
    expect(arena).toMatch(/GEN_STATES\.CLAIMED/);
    expect(arena).toMatch(/generation in progress/);
  });

  it('generation create + sweep route through the store', () => {
    expect(arena).toMatch(/generationStore\.create\(\{/);
    expect(arena).toMatch(/generationStore\.sweep\(now\)/);
  });
});

describe('concurrency gate (F08b)', () => {
  it('admits up to the global cap, then refuses', () => {
    const g = createConcurrencyGate({ maxGlobal: 2, maxPerKey: 5 });
    expect(g.tryEnter('a')).toBe(true);
    expect(g.tryEnter('b')).toBe(true);
    expect(g.tryEnter('c')).toBe(false); // global cap
    expect(g._inFlight()).toBe(2);
  });

  it('bounds per-key concurrency independently of the global cap', () => {
    const g = createConcurrencyGate({ maxGlobal: 10, maxPerKey: 1 });
    expect(g.tryEnter('a')).toBe(true);
    expect(g.tryEnter('a')).toBe(false); // same key already has its one slot
    expect(g.tryEnter('b')).toBe(true);  // another key is fine
  });

  it('leave() frees a slot (global and per-key)', () => {
    const g = createConcurrencyGate({ maxGlobal: 1, maxPerKey: 1 });
    expect(g.tryEnter('a')).toBe(true);
    expect(g.tryEnter('a')).toBe(false);
    g.leave('a');
    expect(g.tryEnter('a')).toBe(true);
    expect(g._perKey('a')).toBe(1);
  });
});