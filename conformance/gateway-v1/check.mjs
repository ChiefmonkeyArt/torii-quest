#!/usr/bin/env node
// Check your world's heartbeat against Torii Gate v1.
//   node conformance/gateway-v1/check.mjs heartbeat.json   (a signed event, or an array)
//   cat heartbeat.json | node conformance/gateway-v1/check.mjs -
//   add --now <unix seconds> to check against a fixed clock (fixtures use 1792540800)
import { readFileSync } from 'node:fs';
import { checkHeartbeat, readHeartbeat } from './gate-v1.mjs';

const argv = process.argv.slice(2);
const ni = argv.indexOf('--now');
const nowSec = ni >= 0 ? Number(argv.splice(ni, 2)[1]) : Math.floor(Date.now() / 1000);
const arg = argv[0];
if (!arg) { console.error('usage: check.mjs <event.json | ->'); process.exit(2); }
let data;
try { data = JSON.parse(readFileSync(arg === '-' ? 0 : arg, 'utf8')); } catch (e) { console.error('cannot read JSON:', e.message); process.exit(2); }
const events = Array.isArray(data) ? data : [data];
let bad = 0;
for (const ev of events) {
  const w = checkHeartbeat(ev, { nowSec });
  const r = readHeartbeat(ev, { nowSec });
  const id = (ev && ev.id ? ev.id.slice(0, 12) : '?') + '…';
  if (w.ok && r.ok) console.log(`PASS ${id} zone=${r.world.zoneId} owner=${r.world.owner.slice(0, 12)}… website=${r.world.website}`);
  else { bad++; console.log(`FAIL ${id}`); for (const e of w.errors) console.log('  - ' + e); if (!r.ok) console.log('  - reader: ' + r.reason); }
}
process.exit(bad ? 1 : 0);
