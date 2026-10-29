#!/usr/bin/env node
// SPDX-License-Identifier: 0BSD
// Regenerates conformance/gateway-v1/fixtures/*.json (deterministic: fixed test
// keys, fixed clock, zero aux randomness). The keys below are PUBLIC test keys;
// never use them for anything real. Run: node tools/gen-gate-v1-fixtures.mjs
import { writeFileSync } from 'node:fs';
import { signEvent, KIND, TOPIC } from '../conformance/gateway-v1/gate-v1.mjs';

const NOW = 1792540800; // 2026-10-20T00:00:00Z, the fixtures' clock
const OWNER_SK = '1'.repeat(64);
const BEACON_SK = '2'.repeat(64);
const OTHER_SK = '3'.repeat(64);
const owner = signEvent({ kind: KIND, created_at: 0, tags: [], content: '' }, OWNER_SK).pubkey;

function hb({ sk = OWNER_SK, zone = 'nap-main', at = NOW - 60, ttl = 1200, content = {}, extraTags = [], noExp = false, rawContent = null, kind = KIND } = {}) {
  const c = { zoneId: zone, title: 'Chiefmonkey World', description: 'A NAP zone', zoneType: 'nap', website: 'https://quest.example.org/', relays: ['wss://relay.example.org/'], topics: [], version: 1, ...content };
  for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k];
  const tags = [['d', zone], ['t', TOPIC], ['zoneType', 'nap'], ['title', 'Chiefmonkey World'], ['relay', 'wss://relay.example.org/'], ...extraTags];
  if (!noExp) tags.push(['expiration', String(at + ttl)]);
  return signEvent({ kind, created_at: at, tags, content: rawContent != null ? rawContent : JSON.stringify(c) }, sk);
}
const tamper = (ev) => ({ ...ev, content: ev.content.replace('A NAP zone', 'A FAKE zone') });

const cases = [
  { name: 'valid owner-signed heartbeat', event: hb(), expect: { listed: true, writerOk: true, world: { zoneId: 'nap-main', owner, website: 'https://quest.example.org/', zoneType: 'nap', travellable: true } } },
  { name: 'beacon-signed heartbeat names the owner in a p tag', event: hb({ sk: BEACON_SK, zone: 'beacon-zone', extraTags: [['p', owner]] }), expect: { listed: true, writerOk: true, world: { zoneId: 'beacon-zone', owner } } },
  { name: 'tampered content fails the signature check', event: tamper(hb({ zone: 'tampered' })), expect: { listed: false, reason: 'bad-signature', writerOk: false } },
  { name: 'expired long ago is stale', event: hb({ zone: 'old', at: NOW - 7200, ttl: 1200 }), expect: { listed: false, reason: 'stale', writerOk: false } },
  { name: 'just-expired but recent (reader clock ahead) stays live', event: hb({ zone: 'skew', at: NOW - 1300, ttl: 1200 }), expect: { listed: true, writerOk: false, world: { zoneId: 'skew' } } },
  { name: 'no expiration, two hours old, is stale', event: hb({ zone: 'noexp-old', at: NOW - 7200, noExp: true }), expect: { listed: false, reason: 'stale', writerOk: false } },
  { name: 'no expiration, recent: listed by readers, but not a conforming writer', event: hb({ zone: 'noexp-new', noExp: true }), expect: { listed: true, writerOk: false, world: { zoneId: 'noexp-new' } } },
  { name: 'a state tag marks a handshake, not presence', event: hb({ zone: 'handshake', extraTags: [['state', 'request']] }), expect: { listed: false, reason: 'stale', writerOk: true } },
  { name: 'markup and control characters are stripped from text', event: hb({ zone: 'markup', content: { title: '<b>Evil</b>\u0007 World' } }), expect: { listed: true, writerOk: true, world: { title: 'bEvil/b World' } } },
  { name: 'http website: listed but not travellable', event: hb({ zone: 'plain-http', content: { website: 'http://quest.example.org/' } }), expect: { listed: true, writerOk: false, world: { website: null, travellable: false } } },
  { name: 'javascript avatar is dropped', event: hb({ zone: 'bad-avatar', content: { avatar: 'javascript:alert(1)' } }), expect: { listed: true, writerOk: true, world: { avatar: null } } },
  { name: 'ws extension: wss kept, the tag wins over content', event: hb({ zone: 'mp', extraTags: [['ws', 'wss://quest.example.org/mp']], content: { wsEndpoint: 'wss://other.example.org/mp' } }), expect: { listed: true, writerOk: true, world: { ws: 'wss://quest.example.org/mp' } } },
  { name: 'travel extension: a Torii world says enter + visit; the tags win over content', event: hb({ zone: 'travel', extraTags: [['world', 'torii-quest'], ['travel', 'enter', 'visit']], content: { worlds: ['other'], travel: ['visit'] } }), expect: { listed: true, writerOk: true, world: { worlds: ['torii-quest'], travel: ['enter', 'visit'] } } },
  { name: 'travel extension: unknown modes, duplicates and bad world ids are dropped', event: hb({ zone: 'travel-junk', extraTags: [['world', 'bad id!'], ['world', 'ok.world'], ['travel', 'teleport', 'visit', 'visit']] }), expect: { listed: true, writerOk: true, world: { worlds: ['ok.world'], travel: ['visit'] } } },
  { name: 'travel extension in content only is read', event: hb({ zone: 'travel-content', content: { travel: ['visit'] } }), expect: { listed: true, writerOk: true, world: { worlds: [], travel: ['visit'] } } },
  { name: 'no travel extension: travel unknown', event: hb({ zone: 'travel-none' }), expect: { listed: true, writerOk: true, world: { worlds: [], travel: null } } },
  { name: 'plaintext ws extension is dropped', event: hb({ zone: 'mp-plain', extraTags: [['ws', 'ws://quest.example.org/mp']] }), expect: { listed: true, writerOk: true, world: { ws: null } } },
  { name: 'unknown zoneType degrades to none', event: hb({ zone: 'odd-type', content: { zoneType: 'casino' } }), expect: { listed: true, writerOk: false, world: { zoneType: null } } },
  { name: 'future version with unknown fields is still read', event: hb({ zone: 'future', content: { version: 2, teleportFx: 'sparkles' } }), expect: { listed: true, writerOk: false, world: { zoneId: 'future' } } },
  { name: 'wrong kind is skipped', event: hb({ zone: 'kind1', kind: 1 }), expect: { listed: false, reason: 'wrong-kind', writerOk: false } },
  { name: 'malformed content JSON falls back to tags', event: hb({ zone: 'tags-only', rawContent: '{not json' }), expect: { listed: true, writerOk: false, world: { zoneId: 'tags-only', title: 'Chiefmonkey World', website: null } } },
];

// Dedupe: two versions of the same zone; only the newest survives.
const dedupe = {
  name: 'newest record per (pubkey, zone) wins',
  events: [hb({ zone: 'moving', at: NOW - 600, content: { title: 'Old' } }), hb({ zone: 'moving', at: NOW - 30, content: { title: 'New' } }), hb({ sk: OTHER_SK, zone: 'moving' })],
  expect: { count: 2, titles: ['New', 'Chiefmonkey World'] },
};

writeFileSync(new URL('../conformance/gateway-v1/fixtures/heartbeats.json', import.meta.url), JSON.stringify({ protocol: 'torii-gate', version: 1, nowSec: NOW, owner, cases, dedupe }, null, 2) + '\n');

const T = 'a'.repeat(64);
const travel = {
  protocol: 'torii-gate', version: 1,
  visit: [
    { name: 'plain visit with traveller', website: 'https://quest.example.org/', traveller: T, expect: { ok: true, url: `https://quest.example.org/?torii-traveller=${T}` } },
    { name: 'zone route appended', website: 'https://quest.example.org/quest/', traveller: T, zone: 'nap-main', expect: { ok: true, url: `https://quest.example.org/quest/?torii-traveller=${T}#/zone/nap-main` } },
    { name: 'anonymous hop', website: 'https://quest.example.org/', expect: { ok: true, url: 'https://quest.example.org/' } },
    { name: 'invalid zone slug ignored', website: 'https://quest.example.org/', zone: 'Bad Slug!', expect: { ok: true, url: 'https://quest.example.org/' } },
    { name: 'http refused', website: 'http://quest.example.org/', expect: { ok: false, error: 'scheme-must-be-https' } },
    { name: 'credentials refused', website: 'https://u:p@quest.example.org/', expect: { ok: false, error: 'no-credentials-in-url' } },
    { name: 'non-default port refused', website: 'https://quest.example.org:8443/', expect: { ok: false, error: 'non-default-port-rejected' } },
    { name: 'private host refused', website: 'https://192.168.1.10/', expect: { ok: false, error: 'private-host-rejected' } },
    { name: 'localhost refused', website: 'https://localhost/', expect: { ok: false, error: 'private-host-rejected' } },
    { name: 'bad traveller key refused', website: 'https://quest.example.org/', traveller: 'npub1xyz', expect: { ok: false, error: 'bad-pubkey' } },
  ],
  arrival: [
    { name: 'traveller claim read', url: `https://quest.example.org/?torii-traveller=${T}`, expect: { ok: true, pubkey: T } },
    { name: 'no traveller', url: 'https://quest.example.org/', expect: { ok: false, error: 'no-traveller' } },
    { name: 'malformed traveller', url: 'https://quest.example.org/?torii-traveller=ZZZ', expect: { ok: false, error: 'bad-pubkey' } },
  ],
};
writeFileSync(new URL('../conformance/gateway-v1/fixtures/travel.json', import.meta.url), JSON.stringify(travel, null, 2) + '\n');
console.log(`wrote ${cases.length} heartbeat cases + dedupe, ${travel.visit.length} visit + ${travel.arrival.length} arrival cases`);
