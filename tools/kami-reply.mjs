#!/usr/bin/env node
// kami-reply.mjs — ADR-0039. Post an AI "Kami reply" into the emagake replies feed.
//
// Runs ON THE VPS (or any machine with the repo + node:fs). Appends a plaintext
// reply to /var/lib/torii-quest/kami/replies.jsonl, which the emagake rack polls
// via GET /mp/kami/replies and renders. The browser cannot decrypt kamiSeal ema
// (NIP-07 has no ECDH), so AI replies are a separate readable feed.
//
// NEVER trusts shell quoting for message text: read the text from a file
// (--text-file) or stdin when it may contain quotes / special chars. --text is
// only for short, safe strings.
//
// Usage:
//   node tools/kami-reply.mjs --text-file /tmp/reply.txt [--ref <ema-id>] [--quote-file /tmp/quote.txt]
//   node tools/kami-reply.mjs --text "short safe reply" [--ref <ema-id>]
//   echo "reply text" | node tools/kami-reply.mjs --ref <ema-id>
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { makeReplyStore, REPLY_TEXT_CAP, REPLY_QUOTE_CAP } from '../server/kami/kamiReplyStore.js';

function die(msg) { console.error(`kami-reply: ${msg}`); process.exit(1); }

function parseArgs(argv) {
  const a = argv.slice(2);
  const out = { textFile: null, quoteFile: null, text: null, ref: null };
  for (let i = 0; i < a.length; i++) {
    const t = a[i];
    if (t === '--text-file') { out.textFile = a[++i]; continue; }
    if (t === '--quote-file') { out.quoteFile = a[++i]; continue; }
    if (t === '--text') { out.text = a[++i]; continue; }
    if (t === '--ref') { out.ref = a[++i]; continue; }
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

const dir = process.env.KAMI_DIR || '/var/lib/torii-quest/kami';
const store = makeReplyStore({ dir });

const id = randomBytes(8).toString('hex');
const ts = Date.now();
await store.appendReply({ id, ts, from: 'kami', ref: args.ref || null, quote: quote || null, text });

console.log(`kami-reply: posted ${id} (ref=${args.ref || 'none'}, text ${Math.min(text.length, REPLY_TEXT_CAP)} chars, quote ${Math.min(quote.length, REPLY_QUOTE_CAP)} chars) -> ${store.replyPath}`);
