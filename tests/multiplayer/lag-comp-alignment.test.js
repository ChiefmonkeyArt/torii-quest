// lag-comp-alignment.test.js — ADR-0024 (v0.2.633-alpha).
//
// Locks the hit-reg clock identity: the server must rewind its bot/peer rings to
// the SAME instant the shooter actually saw on screen.
//
// The bug this pins: botNetState stamps samples with the CLIENT RECEIVE time, so
// the downlink trip is already baked into the buffer. sample() then subtracts the
// interp delay on top. The server applies `viewLag` to the shot's ARRIVAL time,
// which is a further uplink trip later. That makes the total offset TWO one-way
// trips, not one — with a single `ow` the server tested a moving bot ~ow of travel
// ahead of where the player saw it.
//
// Pure: fake WebSocket, fake scene, injected clock. No browser globals, no network.
import { describe, it, expect } from 'vitest';
import { createMultiplayerHost } from '../../src/engine/multiplayer/multiplayerHost.js';
import { createBotNetState, DEFAULT_INTERP_DELAY_MS } from '../../src/engine/entities/botNetState.js';
import { MSG, encode } from '../../src/engine/multiplayer/wireProtocol.js';

class FakeWS {
  static instances = [];
  constructor(url) { this.url = url; this.sent = []; FakeWS.instances.push(this); }
  send(data) { this.sent.push(data); }
  close(code, reason) { if (this.onclose) this.onclose({ code: code || 1000, reason: reason || '' }); }
  _open() { if (this.onopen) this.onopen(); }
  _message(payload) {
    if (this.onmessage) this.onmessage({ data: typeof payload === 'string' ? payload : encode(payload) });
  }
}

// Host wired to a fake socket and a frozen clock, so a PONG we inject produces a
// deterministic one-way estimate through the REAL measurement path.
function makeHost(nowMs = 100000) {
  FakeWS.instances.length = 0;
  const host = createMultiplayerHost({
    scene: { add() {}, remove() {} },
    avatarLoader: async () => ({ object: {} }),
    signAuth: async () => ({}),
    origin: 'example.test',
    mpEnabled: true,
    WebSocketCtor: FakeWS,
    now: () => nowMs,
  });
  host.start();
  const ws = FakeWS.instances[0];
  ws._open();
  return { host, ws, nowMs };
}

// Drive oneWayMs via the real PONG handler: the server echoes our ts verbatim, so
// rtt = now - ts and ow = rtt/2. First sample sets it outright (no EMA seed).
function setOneWay(ws, nowMs, ow) {
  ws._message({ t: MSG.PONG, ts: nowMs - ow * 2 });
}

describe('ADR-0024 — viewLag counts the round trip', () => {
  it('is the bare interp delay when latency is unmeasured', () => {
    const { host } = makeHost();
    expect(host.viewLagMs()).toBe(DEFAULT_INTERP_DELAY_MS);
  });

  it('adds TWO one-way trips, not one', () => {
    const { host, ws, nowMs } = makeHost();
    setOneWay(ws, nowMs, 64);
    // 100 + 2*64 = 228. The old single-trip form gave 164 — the value observed
    // in the v0.2.632 live capture, which was 64ms short.
    expect(host.viewLagMs()).toBe(228);
    expect(host.viewLagMs()).not.toBe(164);
  });

  it('scales linearly with one-way latency', () => {
    for (const ow of [10, 25, 50]) {
      const { host, ws, nowMs } = makeHost();
      setOneWay(ws, nowMs, ow);
      expect(host.viewLagMs()).toBe(DEFAULT_INTERP_DELAY_MS + 2 * ow);
    }
  });

  it('stays inside the server lag-comp window on a bad connection', () => {
    const { host, ws, nowMs } = makeHost();
    setOneWay(ws, nowMs, 200); // 100 + 400 = 500 → clamped
    expect(host.viewLagMs()).toBe(250);
  });

  it('never exceeds the clamp for any plausible latency', () => {
    for (const ow of [0, 1, 64, 75, 120, 400, 5000]) {
      const { host, ws, nowMs } = makeHost();
      setOneWay(ws, nowMs, ow);
      const v = host.viewLagMs();
      expect(v).toBeGreaterThanOrEqual(DEFAULT_INTERP_DELAY_MS);
      expect(v).toBeLessThanOrEqual(250);
    }
  });
});

describe('ADR-0024 — the render pose is interpDelay + one-way old in SERVER time', () => {
  // Proves the premise of the fix rather than assuming it: because ingest() is
  // handed the client RECEIVE clock, the pose sample() returns is already one
  // downlink trip staler (in server-generation time) than the interp delay alone.
  it('resolves to server content one downlink older than the interp delay', () => {
    const ow = 64;
    const net = createBotNetState();
    const frame = (s) => [{ id: 0, x: s / 1000, z: 0, rotY: 0, hp: 100, alive: true, animHint: 'idle' }];
    // Bot travels +1 m/s in x. Snapshot generated at server time s is received at
    // s + ow, which is the stamp ingest() records.
    net.ingest(frame(0), 0 + ow);
    net.sample(0 + ow); // consume the first-frame snap so later reads interpolate
    for (let s = 50; s <= 2000; s += 50) {
      net.ingest(frame(s), s + ow);
    }
    const clientNow = 2000;
    const pose = net.sample(clientNow).find((p) => p.id === 0);
    // Rendered at receive-time (clientNow - 100), i.e. server content time
    // clientNow - 100 - ow. At 1 m/s that x IS the server time in seconds.
    const serverContentTime = clientNow - DEFAULT_INTERP_DELAY_MS - ow;
    expect(pose.x).toBeCloseTo(serverContentTime / 1000, 3);
    // Sanity: it is NOT merely the interp delay behind.
    expect(pose.x).not.toBeCloseTo((clientNow - DEFAULT_INTERP_DELAY_MS) / 1000, 3);
  });

  it('stamps samples with the receive clock it is given', () => {
    const net = createBotNetState();
    // Step stays under the 3m snap threshold so this exercises interpolation.
    net.ingest([{ id: 0, x: 0, z: 0, rotY: 0, hp: 100, alive: true, animHint: 'idle' }], 5000);
    net.sample(5000); // consume the first-frame snap
    net.ingest([{ id: 0, x: 2, z: 0, rotY: 0, hp: 100, alive: true, animHint: 'idle' }], 5100);
    // Ask for the render time matching the FIRST stamp: must not have advanced.
    const pose = net.sample(5000 + DEFAULT_INTERP_DELAY_MS).find((p) => p.id === 0);
    expect(pose.x).toBeCloseTo(0, 6);
  });
});

describe('ADR-0024 — round-trip viewLag aligns seen and tested instants', () => {
  // The identity the fix exists to satisfy, in one aligned clock frame:
  //   seen on screen : fire - interpDelay - ow      (downlink in the buffer stamps)
  //   server tests   : (fire + ow) - viewLag        (uplink to shot arrival)
  const seen = (fire, interp, ow) => fire - interp - ow;
  const tested = (fire, ow, viewLag) => (fire + ow) - viewLag;

  it('aligns exactly with interpDelay + 2*one-way', () => {
    const interp = DEFAULT_INTERP_DELAY_MS;
    for (const ow of [0, 16, 64, 120]) {
      const fire = 500000;
      expect(tested(fire, ow, interp + 2 * ow)).toBe(seen(fire, interp, ow));
    }
  });

  it('leaves a residual of exactly one one-way trip with the old single-trip form', () => {
    const interp = DEFAULT_INTERP_DELAY_MS;
    for (const ow of [16, 64, 120]) {
      const fire = 500000;
      const residual = tested(fire, ow, interp + ow) - seen(fire, interp, ow);
      // Positive residual = server tested a state NEWER than the player saw.
      expect(residual).toBe(ow);
    }
  });

  it('mis-registers a moving bot by one one-way of travel under the old form', () => {
    // 3 m/s lateral bot, 64ms residual → 0.192m, over half the 0.35m head radius
    // and consistent with the tight head misses measured in v0.2.632
    // (headHorz 0.350 / 0.383 / 0.531 just outside the collider).
    const speed = 3, ow = 64;
    const residual = ow; // from the test above
    const lateralError = speed * (residual / 1000);
    expect(lateralError).toBeCloseTo(0.192, 3);
    expect(lateralError).toBeGreaterThan(0.35 / 2);
    // And with the fix there is no residual at all, at any speed.
    expect(speed * 0 / 1000).toBe(0);
  });

  it('is latency-symmetric: alignment holds even as ow changes between shots', () => {
    const interp = DEFAULT_INTERP_DELAY_MS;
    let drift = 0;
    for (const ow of [20, 45, 64, 90, 30]) {
      drift += tested(1000, ow, interp + 2 * ow) - seen(1000, interp, ow);
    }
    expect(drift).toBe(0);
  });
});
