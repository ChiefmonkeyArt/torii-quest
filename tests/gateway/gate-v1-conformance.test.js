// ADR-0144: Torii Gate v1 is FROZEN. Every fixture must pass against BOTH the
// engine-free reference kit and Quest's own reader/writer/travel code. Changing
// the wire format means changing these fixtures, which needs an ADR (v2).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as kit from '../../conformance/gateway-v1/gate-v1.mjs';
import { readGateways } from '../../src/engine/gateway/gatewayRead.js';
import { buildPresenceEvent } from '../../src/engine/gateway/worldPresence.js';
import { buildVisitUrl } from '../../src/engine/gateway/openVisit.js';
import { readArrivingTraveller } from '../../src/engine/gateway/handoffArrival.js';

const HB = JSON.parse(readFileSync('conformance/gateway-v1/fixtures/heartbeats.json', 'utf8'));
const TR = JSON.parse(readFileSync('conformance/gateway-v1/fixtures/travel.json', 'utf8'));
const now = HB.nowSec;

// Quest's preview model → the kit's field names.
const questView = (g) => g && ({ zoneId: g.zoneId, owner: g.owner, website: g.website, travellable: !!g.website, title: g.title, zoneType: g.zoneType, avatar: g.avatar, ws: g.wsEndpoint });

describe('Gate v1 heartbeat fixtures', () => {
  for (const c of HB.cases) {
    it(c.name, () => {
      const k = kit.readHeartbeat(c.event, { nowSec: now });
      expect(k.ok).toBe(c.expect.listed);
      if (!c.expect.listed) expect(k.reason).toBe(c.expect.reason);
      const q = readGateways([c.event], { nowSec: now, verify: true });
      expect(q.count).toBe(c.expect.listed ? 1 : 0);
      if (c.expect.listed) {
        expect(k.world).toMatchObject(c.expect.world || {});
        expect(questView(q.gateways[0])).toMatchObject(c.expect.world || {});
        expect(q.gateways[0].trust).toBe('signature-verified');
      }
      expect(kit.checkHeartbeat(c.event, { nowSec: now }).ok).toBe(c.expect.writerOk);
    });
  }
  it(HB.dedupe.name, () => {
    const k = kit.readWorlds(HB.dedupe.events, { nowSec: now });
    const q = readGateways(HB.dedupe.events, { nowSec: now, verify: true });
    expect(k.map((w) => w.title)).toEqual(HB.dedupe.expect.titles);
    expect(q.gateways.map((g) => g.title)).toEqual(HB.dedupe.expect.titles);
    expect(q.count).toBe(HB.dedupe.expect.count);
  });
  it('fixtures are reproducible (deterministic signatures)', () => {
    const again = kit.signEvent({ kind: 30078, created_at: 1, tags: [], content: '' }, '1'.repeat(64));
    expect(again.pubkey).toBe(HB.owner);
    expect(kit.verifySignature(again)).toBe(true);
  });
});

describe("Quest's writer conforms", () => {
  it('buildPresenceEvent, once signed, passes the strict v1 writer check', () => {
    const owner = kit.signEvent({ kind: 30078, created_at: 0, tags: [], content: '' }, '1'.repeat(64)).pubkey;
    const { ok, event } = buildPresenceEvent({ pubkey: owner, zoneId: 'nap-main', title: 'T', zoneType: 'nap', website: 'https://quest.example.org/', relays: ['wss://relay.example.org/'], wsEndpoint: 'wss://quest.example.org/mp' });
    expect(ok).toBe(true);
    const signed = kit.signEvent(event, '1'.repeat(64));
    const r = kit.checkHeartbeat(signed, { nowSec: signed.created_at });
    expect(r.errors).toEqual([]);
    expect(kit.readHeartbeat(signed, { nowSec: signed.created_at }).world.ws).toBe('wss://quest.example.org/mp');
  });
});

describe('Gate v1 travel + arrival fixtures', () => {
  for (const c of TR.visit) {
    it('visit: ' + c.name, () => {
      const k = kit.visitUrl(c.website, { traveller: c.traveller || '', zone: c.zone || '' });
      const q = buildVisitUrl({ website: c.website }, { ourHex: c.traveller || '', zoneSlug: c.zone || null });
      expect(k.ok).toBe(c.expect.ok);
      expect(q.ok).toBe(c.expect.ok);
      if (c.expect.ok) { expect(k.url).toBe(c.expect.url); expect(q.url).toBe(c.expect.url); }
      else { expect(k.error).toBe(c.expect.error); expect(q.errors).toContain(c.expect.error); }
    });
  }
  for (const c of TR.arrival) {
    it('arrival: ' + c.name, () => {
      const k = kit.readTraveller(c.url);
      const q = readArrivingTraveller(c.url);
      expect(k.ok).toBe(c.expect.ok); expect(q.ok).toBe(c.expect.ok);
      if (c.expect.ok) { expect(k.pubkey).toBe(c.expect.pubkey); expect(q.pubkey).toBe(c.expect.pubkey); expect(k.claim).toBe(true); }
      else { expect(k.error).toBe(c.expect.error); expect(q.error).toBe(c.expect.error); }
    });
  }
});

describe('wiring', () => {
  it('the live directory scan verifies signatures', () => {
    expect(readFileSync('src/main.js', 'utf8')).toMatch(/retries: 1,\n\s+verify: true,/);
  });
  it('the kit has no Torii imports (copyable into any world)', () => {
    const src = readFileSync('conformance/gateway-v1/gate-v1.mjs', 'utf8');
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.every((i) => i.startsWith('@noble/'))).toBe(true);
  });
});
