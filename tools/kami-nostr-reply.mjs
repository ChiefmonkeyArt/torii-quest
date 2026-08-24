#!/usr/bin/env node
// tools/kami-nostr-reply.mjs — ADR-0040 Stage 1.
//
// Post a Kami reply BOTH to the in-game emagake feed (replies.jsonl, ADR-0039,
// unchanged) AND as a native NIP-17 gift-wrapped DM (kind:1059) to the owner's
// npub, so it shows up as a real Nostr direct message in Buzz / Amethyst /
// Nostir. Kami is the sender (kami-priv); the owner is the recipient (public
// npub only — Kami never needs the owner's private key). The in-game rack still
// reads replies.jsonl via GET /mp/kami/replies, so the rack is unaffected.
//
// NEVER trusts shell quoting for message text: read from --text-file or stdin
// when the text may contain quotes / special chars. --text is short-safe only.
//
// Run ON THE VPS as the torii-quest user (so it can write replies.jsonl):
//   sudo -u torii-quest bash -c 'KAMI_PRIV=$(cat /var/lib/torii-quest/kami/kami-priv.hex) \
//     QUEST_ADMIN_NPUB=npub1... node /opt/torii-suite/work/torii-quest/tools/kami-nostr-reply.mjs --text-file /tmp/r.txt'
// (sudo -u scrubs env, so set KAMI_PRIV inside the torii-quest shell, not outside.)
//
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { WebSocket as UndiciWebSocket } from 'undici'; // declared dep (browser-API compatible WS: onopen/onmessage/onerror/onclose + send). Node 20 has no global WebSocket.
import { ADMIN_PUBKEY_HEX } from '../src/config.js';
import { makeReplyStore, REPLY_TEXT_CAP, REPLY_QUOTE_CAP } from '../server/kami/kamiReplyStore.js';
import { buildGiftWrap, publishEventToRelay, DEFAULT_NOSTR_RELAYS } from '../server/kami/kamiNostr.js';

function die(msg) { console.error(`kami-nostr-reply: ${msg}`); process.exit(1); }

function parseArgs(argv) {
  const a = argv.slice(2);
  const out = { textFile: null, quoteFile: null, text: null, ref: null, relays: null, dryRun: false };
  for (let i = 0; i < a.length; i++) {
    const t = a[i];
    if (t === '--text-file') { out.textFile = a[++i]; continue; }
    if (t === '--quote-file') { out.quoteFile = a[++i]; continue; }
    if (t === '--text') { out.text = a[++i]; continue; }
    if (t === '--ref') { out.ref = a[++i]; continue; }
    if (t === '--relays') { out.relays = a[++i].split(',').map(s => s.trim()).filter(Boolean); continue; }
    if (t === '--dry-run') { out.dryRun = true; continue; }
  }
  return out;
}

const args = parseArgs(process.argv);

let text = '';
if (args.textFile) {
  try { text = readFileSync(args.textFile, 'utf8'); }
  catch (e) { die(`cannot read --text-file: ${e.message}`); }
} else if (args.text != null) {
  text = args.text;
} else {
  try { text = readFileSync(0, 'utf8'); }
  catch (e) { die(`no --text/--text-file and stdin read failed: ${e.message}`); }
}
text = String(text).trim();
if (!text) die('reply text is empty');

let quote = '';
if (args.quoteFile) {
  try { quote = readFileSync(args.quoteFile, 'utf8').trim(); }
  catch (e) { die(`cannot read --quote-file: ${e.message}`); }
}

const KAMI_PRIV = process.env.KAMI_PRIV || '';
if (!KAMI_PRIV) die('KAMI_PRIV env not set (hex). Get it from /home/user/workspace/.secrets/kami-priv.hex');
if (!ADMIN_PUBKEY_HEX) die('ADMIN_PUBKEY_HEX is empty (config.js)');

// 1) Build the NIP-17 gift wrap (pure, no I/O).
const built = buildGiftWrap({ kamiPrivHex: KAMI_PRIV, ownerPubHex: ADMIN_PUBKEY_HEX, text });
if (!built.ok) die(`buildGiftWrap failed: ${built.error}`);
const { wrap, id: eventId, ts } = built;

// 2) Dual-write the plaintext reply to the in-game emagake feed (ADR-0039 path).
const dir = process.env.KAMI_DIR || '/var/lib/torii-quest/kami';
const store = makeReplyStore({ dir });
const lineId = randomBytes(8).toString('hex');
await store.appendReply({ id: lineId, ts, from: 'kami', ref: args.ref || null, quote: quote || null, text: built.text });

if (args.dryRun) {
  console.log(`kami-nostr-reply: DRY-RUN wrap=${eventId.slice(0,12)} jsonl=${lineId} text=${Math.min(built.text.length, REPLY_TEXT_CAP)}c (no relay publish)`);
  process.exit(0);
}

// 3) Publish the NIP-17 gift wrap to relays (best-effort; the in-game feed is
//    already written, so a relay failure does not lose the reply).
const relays = args.relays && args.relays.length ? args.relays : DEFAULT_NOSTR_RELAYS;
// Node 20 has no global WebSocket; undici (Node 18+ built-in) is browser-API
// compatible (onopen/onmessage/onerror/onclose + send). Falls back to a global
// WebSocket if present (Node 22+ / browser).
const NodeWS = typeof WebSocket !== 'undefined' ? WebSocket : UndiciWebSocket;
const results = await Promise.all(relays.map((url) => publishEventToRelay(url, wrap, { WebSocketCtor: NodeWS })));
const accepted = results.filter(r => r.accepted).map(r => r.relay);
const rejected = results.filter(r => !r.accepted).map(r => `${r.relay}(${r.reason})`);

console.log(`kami-nostr-reply: posted jsonl=${lineId} nostr=${eventId.slice(0,12)} text=${Math.min(built.text.length, REPLY_TEXT_CAP)}c quote=${Math.min(quote.length, REPLY_QUOTE_CAP)}c`);
console.log(`  in-game: ${store.replyPath}`);
console.log(`  nostr accepted: ${accepted.length}/${results.length}` + (accepted.length ? ` -> ${accepted.join(', ')}` : ''));
if (rejected.length) console.log(`  nostr rejected: ${rejected.join(', ')}`);
