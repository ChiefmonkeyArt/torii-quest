// tests/serialized-poll.test.js — audit F11 serialized polling throttle.
// The shell's title-screen ticker used frame counters with no in-flight guard,
// so slow requests could overlap and settle out of order. createSerializedPoller
// converts cadence to wall-clock and serializes per key.
import { describe, it, expect } from 'vitest';
import { createSerializedPoller, POLL_MS } from '../src/engine/polling/serializedPoll.js';

// flush a microtask chain (run is scheduled via Promise.resolve().then(...)).
const flush = (n = 4) => (async () => { for (let i = 0; i < n; i++) await Promise.resolve(); })();

function controllableClock(start = 0) {
  return { now: start, advance(ms) { this.now += ms; } };
}

describe('createSerializedPoller', () => {
  it('runs immediately on the first poll for a key (no warm-up)', async () => {
    let ran = 0;
    const p = createSerializedPoller();
    expect(p.poll('k', 2000, () => { ran += 1; })).toBe(true);
    await flush();
    expect(ran).toBe(1);
  });

  it('throttles a second poll within the interval (elapsed-time cadence)', async () => {
    const clock = controllableClock(0);
    const p = createSerializedPoller(() => clock.now);
    let ran = 0;
    expect(p.poll('k', 2000, () => { ran += 1; })).toBe(true);
    await flush();
    expect(ran).toBe(1);

    clock.advance(1999);
    expect(p.poll('k', 2000, () => { ran += 1; })).toBe(false);
    expect(ran).toBe(1);

    clock.advance(1); // now a full 2000ms elapsed
    expect(p.poll('k', 2000, () => { ran += 1; })).toBe(true);
    await flush();
    expect(ran).toBe(2);
  });

  it('serializes: never overlaps a slow in-flight request for the same key', async () => {
    const clock = controllableClock(0);
    const p = createSerializedPoller(() => clock.now);
    let resolveFirst;
    let calls = 0;
    const slow = () => {
      calls += 1;
      return new Promise((r) => { resolveFirst = r; });
    };

    expect(p.poll('k', 100, slow)).toBe(true); // starts, becomes in-flight
    await flush();
    expect(calls).toBe(1);
    expect(p.isInFlight('k')).toBe(true);

    clock.advance(200); // interval elapsed, but still in-flight → must skip
    expect(p.poll('k', 100, slow)).toBe(false); // skipped: would overlap
    expect(calls).toBe(1);

    resolveFirst();
    await flush();
    expect(p.isInFlight('k')).toBe(false);

    // now free to run again
    expect(p.poll('k', 100, slow)).toBe(true);
    await flush();
    expect(calls).toBe(2);
  });

  it('swallows a rejected run so a failed poll cannot collide the loop', async () => {
    const p = createSerializedPoller();
    let calls = 0;
    const boom = () => { calls += 1; return Promise.reject(new Error('x')); };

    expect(p.poll('k', 100, boom)).toBe(true);
    await flush();
    expect(calls).toBe(1);
    expect(p.isInFlight('k')).toBe(false);
  });

  it('keeps per-key slots independent', async () => {
    const p = createSerializedPoller();
    let a = 0;
    let b = 0;
    expect(p.poll('a', 1000, () => { a += 1; })).toBe(true);
    expect(p.poll('b', 1000, () => { b += 1; })).toBe(true);
    await flush();
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it('exposes the preserved cadence contract', () => {
    expect(POLL_MS.handshake).toBe(2000);
    expect(POLL_MS.presence).toBe(10000);
    expect(POLL_MS.heartbeat).toBe(2000);
    expect(POLL_MS.beaconSync).toBe(10000);
  });
});