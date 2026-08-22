// emaModel.js — ADR-0025. Pure ema record + tray logic for Kami Mode.
//
// An "ema" (絵馬) is the wooden plaque a shrine visitor writes a wish on and
// hangs up: a note, pinned to a place. That is exactly this feature — the owner
// hangs a note at a spot in the world (or on a menu control) and it stays until
// the thing it describes is built or fixed.
//
// DOM-FREE AND CRYPTO-FREE ON PURPOSE. Everything here is a plain data
// transform so it is fully unit-testable with no browser and no key material.
// Capture glue (hotkey, element hit-test, frame grab, POST) lives in
// kamiMode.js; sealing lives in kamiSeal.js; persistence lives server-side.
//
// TWO KINDS, ONE FLOW (owner's requirement: "point at a button > create ema >
// click on another feature > create another ema > hit save"):
//   'world' — pinned to a 3D point: player position + camera angles.
//   'ui'    — pinned to a DOM control: selector + on-screen rect.
// Both accumulate in a TRAY and are sealed and sent in ONE batch when hung, so
// noting three things in a row never costs three round trips or breaks flow.
//
// LIFECYCLE, NOT PERMANENCE (owner: "they should stay until the bug is fixed or
// the feature is created"). An ema is OPEN until explicitly resolved with a
// version + reference. In-world plaques are drawn only while OPEN, so the world
// empties as work lands and a crowded world means a crowded backlog.

export const EMA_KIND = { WORLD: 'world', UI: 'ui' };
export const EMA_STATUS = { OPEN: 'open', RESOLVED: 'resolved' };

// Note cap. Long enough for a real thought, short enough that the JSONL stays
// greppable and a runaway paste cannot bloat a batch.
export const NOTE_MAX = 600;

// Tray cap. Not a storage limit — a flow limit: past ~24 unsent notes in one
// sitting the owner has lost track of what is in the batch, and a single failed
// POST would lose the lot.
export const TRAY_MAX = 24;

// Screenshot retention. Owner's call: "default to on, then cull anything after
// 420". Applies to IMAGES ONLY — ema text and state are kept forever, since
// they are tiny and are the part worth searching later.
export const SCREENSHOT_KEEP = 420;

function isFiniteNum(n) { return typeof n === 'number' && Number.isFinite(n); }

/** Round to 2dp so records stay readable and diffable; sub-cm precision is noise. */
function r2(n) { return Math.round(n * 100) / 100; }

/**
 * Normalise a world capture. Returns null when the input cannot describe a place,
 * which callers treat as "fall back to a UI ema" rather than writing a junk record.
 */
export function normaliseWorldTarget(input) {
  if (!input || typeof input !== 'object') return null;
  const p = input.pos;
  if (!p || !isFiniteNum(p.x) || !isFiniteNum(p.y) || !isFiniteNum(p.z)) return null;
  const out = { pos: { x: r2(p.x), y: r2(p.y), z: r2(p.z) } };
  if (isFiniteNum(input.yaw))   out.yaw   = r2(input.yaw);
  if (isFiniteNum(input.pitch)) out.pitch = r2(input.pitch);
  // What the crosshair was over, when the caller could resolve it. This is the
  // difference between "something is wrong here" and "THIS bot is wrong".
  if (input.lookingAt && typeof input.lookingAt === 'object') {
    const la = input.lookingAt;
    out.lookingAt = {};
    if (la.kind) out.lookingAt.kind = String(la.kind).slice(0, 32);
    if (la.name) out.lookingAt.name = String(la.name).slice(0, 48);
    if (isFiniteNum(la.id))   out.lookingAt.id   = la.id;
    if (isFiniteNum(la.dist)) out.lookingAt.dist = r2(la.dist);
  }
  return out;
}

/**
 * Normalise a UI capture. `selector` is what makes the note actionable — an id
 * beats a rect, because a rect goes stale the moment the layout changes.
 */
export function normaliseUiTarget(input) {
  if (!input || typeof input !== 'object') return null;
  const sel = typeof input.selector === 'string' ? input.selector.trim() : '';
  if (!sel) return null;
  const out = { selector: sel.slice(0, 200) };
  if (input.tag)   out.tag   = String(input.tag).toLowerCase().slice(0, 24);
  // Visible label text: the fastest way for a human to recognise which control
  // this was, even after the selector has been refactored away.
  if (input.text)  out.text  = String(input.text).trim().replace(/\s+/g, ' ').slice(0, 80);
  if (input.phase) out.phase = String(input.phase).slice(0, 32);
  const rect = input.rect;
  if (rect && isFiniteNum(rect.x) && isFiniteNum(rect.y)) {
    out.rect = {
      x: Math.round(rect.x), y: Math.round(rect.y),
      w: Math.round(rect.w || 0), h: Math.round(rect.h || 0),
    };
  }
  return out;
}

/**
 * Build one ema record. THROWS on inputs that would produce a useless record —
 * an empty note or a kind with no matching target is a capture bug, and failing
 * loudly at capture time is better than discovering blank plaques later.
 *
 * @param {object} input
 *   note      {string}  required, trimmed, capped at NOTE_MAX
 *   kind      {string}  EMA_KIND.WORLD | EMA_KIND.UI
 *   world     {object}  required when kind==='world'
 *   ui        {object}  required when kind==='ui'
 *   snapshot  {object}  optional ToriiDebug.snapshot() output
 *   shotId    {string}  optional id of the stored screenshot
 *   version   {string}  build version string
 *   ts        {number}  epoch ms
 *   id        {string}  caller-supplied unique id
 */
export function makeEma(input = {}) {
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (!note) throw new Error('ema: note is required');

  const kind = input.kind === EMA_KIND.UI ? EMA_KIND.UI : EMA_KIND.WORLD;
  const world = kind === EMA_KIND.WORLD ? normaliseWorldTarget(input.world) : null;
  const ui    = kind === EMA_KIND.UI    ? normaliseUiTarget(input.ui)       : null;
  if (kind === EMA_KIND.WORLD && !world) throw new Error('ema: world ema needs a valid position');
  if (kind === EMA_KIND.UI    && !ui)    throw new Error('ema: ui ema needs a selector');

  const rec = {
    id: String(input.id || '').trim(),
    kind,
    status: EMA_STATUS.OPEN,
    note: note.slice(0, NOTE_MAX),
    ts: isFiniteNum(input.ts) ? Math.round(input.ts) : 0,
    version: typeof input.version === 'string' ? input.version : '',
  };
  if (!rec.id) throw new Error('ema: id is required');
  if (world) rec.world = world;
  if (ui)    rec.ui = ui;
  // The snapshot is the machine's account of the same moment as the note. Kept
  // whole and unfiltered: the point of Kami Mode is that I do not have to
  // guess which field mattered.
  if (input.snapshot && typeof input.snapshot === 'object') rec.snapshot = input.snapshot;
  if (input.shotId) rec.shotId = String(input.shotId);
  return rec;
}

/** True when the note would be rejected — lets the UI disable "hang" live. */
export function noteIsValid(note) {
  return typeof note === 'string' && note.trim().length > 0 && note.trim().length <= NOTE_MAX;
}

// ── tray (pure array transforms; the caller owns the array) ─────────────────

export function addToTray(tray, rec, max = TRAY_MAX) {
  const list = Array.isArray(tray) ? tray : [];
  if (list.length >= max) {
    return { tray: list, added: false, reason: `tray full (${max})` };
  }
  return { tray: [...list, rec], added: true, reason: null };
}

export function removeFromTray(tray, id) {
  const list = Array.isArray(tray) ? tray : [];
  return list.filter((r) => r && r.id !== id);
}

/** Rough sealed size of the pending batch, for a size hint in the tray UI. */
export function trayBytes(tray) {
  const list = Array.isArray(tray) ? tray : [];
  let n = 0;
  for (const r of list) {
    n += JSON.stringify(r).length;
    // Base64 costs ~1.34x the raw image (see kamiSeal); shots are counted by the
    // caller passing `shotBytes` on the record when it has one.
    if (isFiniteNum(r.shotBytes)) n += Math.round(r.shotBytes * 1.34);
  }
  return n;
}

/**
 * Decide which stored screenshots to delete, newest-first retention.
 *
 * Takes ids already ordered oldest→newest (the JSONL append order) and returns
 * the ones beyond the keep window. Text records are never dropped — only the
 * images they reference, so an old ema still reads, just without its picture.
 */
export function screenshotsToCull(shotIdsOldestFirst, keep = SCREENSHOT_KEEP) {
  const ids = Array.isArray(shotIdsOldestFirst) ? shotIdsOldestFirst.filter(Boolean) : [];
  const limit = Math.max(0, keep);
  if (ids.length <= limit) return [];
  return ids.slice(0, ids.length - limit);
}

/** Mark an ema resolved. Resolved ema stop being drawn in-world. */
export function resolveEma(rec, { version = '', ref = '', ts = 0 } = {}) {
  if (!rec || typeof rec !== 'object') throw new Error('ema: cannot resolve non-record');
  return {
    ...rec,
    status: EMA_STATUS.RESOLVED,
    resolved: {
      version: String(version || ''),
      ref: String(ref || ''),
      ts: isFiniteNum(ts) ? Math.round(ts) : 0,
    },
  };
}

/** Only OPEN ema get plaques in the world. */
export function openEma(records) {
  const list = Array.isArray(records) ? records : [];
  return list.filter((r) => r && r.status === EMA_STATUS.OPEN);
}

// Width of the base36 timestamp in an ema id. MUST be fixed: base36 strings of
// DIFFERENT lengths do not sort lexicographically in time order (a 5-char '5f4a8'
// sorts before a 4-char 'lfls' even though it is the later instant), which would
// silently break `sort` on the JSONL. 9 chars covers epoch-ms past the year 5000.
const ID_TIME_WIDTH = 9;

/**
 * Build the id for a capture. Zero-padded time prefix so a plain `sort` on the
 * JSONL really is chronological, plus a short random suffix so two captures in
 * the same millisecond cannot collide.
 */
export function makeEmaId(ts, rand = Math.random) {
  const t = isFiniteNum(ts) ? Math.round(ts) : 0;
  const stamp = t.toString(36).padStart(ID_TIME_WIDTH, '0');
  const suffix = Math.floor(rand() * 0xffffff).toString(16).padStart(6, '0');
  return `ema_${stamp}_${suffix}`;
}
