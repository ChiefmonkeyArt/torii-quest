#!/usr/bin/env node
// tools/kami-autocap-dump.mjs — ADR-0055.
//
// Decrypt the 1Hz auto-capture ring (pulled from the VPS) into JPEG frames + a
// timeline.jsonl so the run-up to a gameplay incident can be reviewed as a
// sequence of frames (or stitched into an MP4 with ffmpeg when --video is set).
//
// The autocap ring is SEALED in the browser to the owner + Kami pubkey, so this
// tool needs KAMI_PRIV (the Kami private key) to open it. Each ring file is ONE
// JSON record {id, ts, requester, ema, shot} — the ring dir IS the store (no
// separate index). Run from the sandbox after pulling the ring:
//
//   export KAMI_PRIV=$(cat /home/user/workspace/.secrets/kami-priv.hex)
//   node tools/kami-autocap-dump.mjs --ring /tmp/autocap-ring --out /tmp/frames
//
// --ring  : the VPS autocap dir (contains autocap/<id>.json ring files)
// --out   : destination dir for frames/ + timeline.jsonl (created)
// --video : also stitch frames into frames.mp4 via the pre-installed ffmpeg
//
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openJson, openSealed } from '../src/engine/kami/kamiSeal.js';

function die(msg) { console.error(`kami-autocap-dump: ${msg}`); process.exit(1); }

function parseArgs(argv) {
  const a = argv.slice(2);
  const out = { ring: null, outDir: null, video: false };
  for (let i = 0; i < a.length; i++) {
    const t = a[i];
    if (t === '--ring') { out.ring = a[++i]; continue; }
    if (t === '--out') { out.outDir = a[++i]; continue; }
    if (t === '--video') { out.video = true; continue; }
  }
  return out;
}

const args = parseArgs(process.argv);
if (!args.ring) die('--ring <dir> is required (the VPS autocap directory)');
if (!args.outDir) die('--out <dir> is required (destination for frames)');
const kamiPriv = process.env.KAMI_PRIV;
if (!kamiPriv) die('KAMI_PRIV env var is required (the Kami private key, hex)');

const ringDir = resolve(args.ring);
const autocapDir = join(ringDir, 'autocap');
if (!existsSync(autocapDir)) die(`no autocap ring at ${autocapDir}`);
const outDir = resolve(args.outDir);
const framesDir = join(outDir, 'frames');
mkdirSync(framesDir, { recursive: true });

// Ring files are autocap/<id>.json, each {id, ts, requester, ema, shot}.
const files = readdirSync(autocapDir).filter(f => f.endsWith('.json')).sort();
const timeline = [];
let frameNo = 0;
for (const fname of files) {
  let rec;
  try { rec = JSON.parse(readFileSync(join(autocapDir, fname), 'utf8')); } catch { continue; }
  const { id, ts, ema, shot } = rec;
  if (!ema) continue;
  let snapshot = null;
  try { snapshot = await openJson(ema, kamiPriv); } catch { /* skip unreadable */ }
  let jpegPath = null;
  if (shot && shot.env) {
    try {
      const bytes = await openSealed(shot.env, kamiPriv);
      frameNo += 1;
      jpegPath = join(framesDir, `frame-${String(frameNo).padStart(5, '0')}.jpg`);
      writeFileSync(jpegPath, Buffer.from(bytes));
    } catch { /* shot unreadable, keep the snapshot */ }
  }
  timeline.push({
    n: frameNo,
    frameId: id,
    ts,
    jpeg: jpegPath ? `frames/frame-${String(frameNo).padStart(5, '0')}.jpg` : null,
    snapshot,
  });
}

writeFileSync(join(outDir, 'timeline.jsonl'), timeline.map(r => JSON.stringify(r)).join('\n') + '\n');
console.log(`kami-autocap-dump: ${timeline.length} records, ${frameNo} frames → ${framesDir}`);

if (args.video && frameNo > 0) {
  // Stitch JPEGs into an MP4 at 1 frame/sec (1Hz capture → 1fps playback of the
  // captured moments; the playback is NOT real-time — it's a flipbook of the
  // captured stills, which is what makes a transient phantom visible frame-by-frame).
  const listPath = join(outDir, 'frames.txt');
  const list = timeline.filter(r => r.jpeg).map(r => `file '${join(outDir, r.jpeg)}'`).join('\n');
  writeFileSync(listPath, list + '\n');
  const mp4Path = join(outDir, 'frames.mp4');
  // scale=trunc(iw/2)*2:trunc(ih/2)*2 rounds odd frame dimensions down to the
  // nearest even number; yuv420p (and libx264) require even width/height.
  const r = spawnSync('ffmpeg', ['-y', '-r', '1', '-f', 'concat', '-safe', '0', '-i', listPath, '-vf', 'fps=1,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-pix_fmt', 'yuv420p', mp4Path], { stdio: 'inherit' });
  if (r.status === 0) console.log(`kami-autocap-dump: video → ${mp4Path}`);
  else console.error('kami-autocap-dump: ffmpeg failed (is it installed?)');
}
