// ADR-0140 stage 2 check: an operator-run, end-to-end probe of the LIVE world
// directory on a real device. From the browser console, with the gateway
// screen open:  await ToriiDebug.gatewayLiveProbe()
//
// It signs ONE heartbeat with a throwaway key generated in the browser (never
// the operator's identity), publishes it to the node relays, and times:
//   publishMs: until EVERY relay has answered (the slowest; see failedRelays)
//   arrivalMs: until the live subscription pushes it back
//   listedMs:  until it is in the directory the screen renders
// The probe world drops out of every Gate v1 reader within ~90 s: it expires
// after 60 s, and created_at is back-dated so the §3.2 clock-skew grace ends
// 90 s after publishing. Loaded by dynamic import only (not in the entry).
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { nostrEventId } from '../crypto/nostrSig.js';
import { GATEWAY_KIND, GATEWAY_TOPIC, PRESENCE_GRACE_SEC } from './gatewayRead.js';

export const PROBE_TTL_SEC = 60;
export const PROBE_VISIBLE_SEC = 90;
export const PROBE_TIMEOUT_MS = 20000;

/** Pure: the signed probe heartbeat. `secretKey` is a 32-byte Uint8Array. */
export function buildProbeEvent({ nowSec, website, secretKey, tag }) {
  const zoneId = 'live-probe-' + tag;
  const created_at = nowSec - PRESENCE_GRACE_SEC + PROBE_VISIBLE_SEC;
  const content = { zoneId, title: 'Torii live probe (test, gone in 90 s)', description: 'Operator check of the live world list. Safe to ignore.', zoneType: 'gallery', website, version: 1 };
  const ev = {
    kind: GATEWAY_KIND, created_at, content: JSON.stringify(content),
    tags: [['d', zoneId], ['t', GATEWAY_TOPIC], ['zoneType', 'gallery'], ['title', content.title], ['expiration', String(nowSec + PROBE_TTL_SEC)]],
    pubkey: bytesToHex(schnorr.getPublicKey(secretKey)),
  };
  ev.id = nostrEventId(ev);
  ev.sig = bytesToHex(schnorr.sign(hexToBytes(ev.id), secretKey));
  return { event: ev, zoneId };
}

/**
 * Run the probe. Everything with side effects is injected:
 *   live:       the live-directory controller (active, onArrival)
 *   publish:    (event) → Promise<{accepted, used, failed}>
 *   isListed:   (zoneId) → boolean (is it in the directory cache?)
 *   website:    https URL the probe world points at (the operator's own Quest)
 */
export async function runLiveProbe({ live, publish, isListed, website, transport = '', now = () => Date.now(), timeoutMs = PROBE_TIMEOUT_MS, secretKey = schnorr.utils.randomSecretKey() }) {
  const out = { ok: false, transport, zoneId: null, accepted: 0, failedRelays: [], publishMs: null, arrivalMs: null, listedMs: null, error: null, note: `probe world expires in ${PROBE_TTL_SEC} s and leaves every directory within ${PROBE_VISIBLE_SEC} s` };
  if (!live || !live.active) { out.error = 'live-inactive: open the in-world gateway screen (or the menu while logged in) first'; return out; }
  if (typeof website !== 'string' || !/^https:\/\//.test(website)) { out.error = 'website must be https'; return out; }
  const tag = bytesToHex(secretKey).slice(0, 8);
  const { event, zoneId } = buildProbeEvent({ nowSec: Math.floor(now() / 1000), website, secretKey, tag });
  out.zoneId = zoneId;
  let arrivedAt = 0;
  const off = typeof live.onArrival === 'function' ? live.onArrival((e, at) => { if (e && e.id === event.id && !arrivedAt) arrivedAt = at || now(); }) : () => {};
  const t0 = now();
  // v0.2.914: watch for the push + listing WHILE publishing. fanoutPublish waits
  // for every relay (a slow one holds it to its 5 s timeout), so measuring the
  // listing only after publish resolved inflated listedMs to ≥ publishMs.
  const listed = new Promise((resolve) => {
    const deadline = t0 + timeoutMs;
    const check = () => {
      if (arrivedAt && out.arrivalMs == null) out.arrivalMs = arrivedAt - t0;
      if (arrivedAt && isListed(zoneId)) { out.listedMs = now() - t0; resolve(true); return; }
      if (now() >= deadline || out.error) { resolve(false); return; }
      setTimeout(check, 25);
    };
    check();
  });
  try {
    const r = await publish(event);
    out.accepted = (r && r.accepted) || 0;
    out.publishMs = now() - t0;
    out.failedRelays = (r && Array.isArray(r.failed)) ? r.failed.slice(0, 16) : [];
    if (!out.accepted) { out.error = 'no relay accepted the probe'; await listed; return out; }
    await listed;
    out.ok = out.listedMs != null;
    if (!out.ok) out.error = arrivedAt ? 'pushed but never listed (reader rejected it?)' : `not pushed within ${timeoutMs} ms`;
    return out;
  } catch (e) {
    out.error = 'probe failed: ' + ((e && e.message) || e);
    await listed;
    return out;
  } finally { off(); }
}
