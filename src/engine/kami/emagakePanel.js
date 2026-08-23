// emagakePanel.js — ADR-0025. The emagake: list view of the ema rack.
//
// An emagake (絵馬掛け) is the wooden rack at a shrine where every visitor's ema
// hangs side by side. This is that rack as a working list — the owner's todo
// panel, sitting beside the chat and floating over the world in-game.
//
// SPLIT ON PURPOSE: the ordering, counting and meta-line formatting below are
// pure functions taking plain records, so the rules that decide what the owner
// sees first are unit-testable without a browser. Only `renderEmagake` touches
// the DOM, and it only writes into markup that already exists in index.html.
//
// It renders OPEN and RESOLVED alike: a rack you can only see unfinished work on
// hides the fact that something was fixed. Resolved rows fade back (and stop
// being drawn in the world entirely — see emaModel.openEma) rather than vanish.

import { EMA_KIND, EMA_STATUS } from './emaModel.js';

/**
 * Rack order: OPEN before RESOLVED, newest first within each group.
 *
 * Newest-first because Kami Mode is used mid-session — the note just written is
 * the one being worked on, and it must not be pushed off the bottom by a
 * fortnight of older ema.
 */
export function sortForRack(records) {
  const list = Array.isArray(records) ? records.filter(Boolean) : [];
  return [...list].sort((a, b) => {
    const ao = a.status === EMA_STATUS.OPEN ? 0 : 1;
    const bo = b.status === EMA_STATUS.OPEN ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return (b.ts || 0) - (a.ts || 0);
  });
}

export function countOpen(records) {
  const list = Array.isArray(records) ? records : [];
  return list.filter((r) => r && r.status === EMA_STATUS.OPEN).length;
}

/** Header badge text. Shows resolved count only once something has been fixed. */
export function rackSummary(records) {
  const list = Array.isArray(records) ? records.filter(Boolean) : [];
  const open = countOpen(list);
  const done = list.length - open;
  return done > 0 ? `${open} OPEN · ${done} DONE` : `${open} OPEN`;
}

/** Clock time only — the date is noise for notes written today, and the full
 *  timestamp is in the record for anything that needs it. */
export function formatTime(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * The mono meta strip under each note: WHERE it was pinned, and when.
 * A world ema shows coordinates; a UI ema shows the selector, because that is
 * what makes each one actionable later.
 */
export function metaLine(rec) {
  if (!rec) return '';
  const time = formatTime(rec.ts);
  const parts = [];
  if (rec.kind === EMA_KIND.UI && rec.ui) {
    parts.push(rec.ui.selector);
    if (rec.ui.phase) parts.push(rec.ui.phase);
  } else if (rec.world && rec.world.pos) {
    const p = rec.world.pos;
    parts.push(`${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`);
    // Naming what the crosshair was over turns "something is wrong here" into
    // "Sleepy is wrong" — the single most useful field when reading back.
    if (rec.world.lookingAt && rec.world.lookingAt.name) parts.push(rec.world.lookingAt.name);
  }
  if (time) parts.push(time);
  return parts.filter(Boolean).join(' · ');
}

// ADR-0039: merge AI reply records into the rack. The browser polls
// GET /mp/kami/replies and holds a session-scoped list; this merges incoming
// replies (already-in-memory + newly polled) deduped by id, newest-first, capped.
export function mergeReplies(prev, incoming) {
  const seen = new Set();
  const out = [];
  for (const r of [...(incoming || []), ...(prev || [])]) {
    if (!r || !r.id || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return out.slice(0, 64);
}

/**
 * Render the rack into #emagake. Idempotent: rebuilds the body from scratch each
 * call, which is correct at this scale (hundreds of rows at most) and removes any
 * chance of stale rows surviving a status change.
 *
 * @param {object[]} records
 * @param {object} [opts]
 *   doc      {Document}  injectable for tests
 *   onSelect {(rec) => void}  row click — used to waypoint to the ema's pin
 *   shotUrl  {(rec) => string|null}  thumbnail lookup, if images are loaded
 */
export function renderEmagake(records, opts = {}) {
  const doc = opts.doc || (typeof document !== 'undefined' ? document : null);
  if (!doc) return 0;
  const body = doc.getElementById('emagake-body');
  if (!body) return 0;

  const rows = sortForRack(records);
  const replies = Array.isArray(opts.replies) ? mergeReplies([], opts.replies) : [];
  const countEl = doc.getElementById('emagake-count');
  if (countEl) countEl.textContent = rackSummary(rows);

  body.textContent = '';

  if (rows.length === 0 && replies.length === 0) {
    const empty = doc.createElement('div');
    empty.id = 'emagake-empty';
    empty.innerHTML = 'RACK IS EMPTY<br><span style="font-size:8px;">SHIFT+K TO HANG</span>';
    body.appendChild(empty);
    return 0;
  }

  // ADR-0039: AI replies render as a distinct block above the ema rack.
  // Newest-first, self-contained (each row carries an optional short quote of
  // the ema it replies to, since the browser cannot decrypt the original ema).
  // textContent only — never innerHTML — reply text is AI-generated and must
  // not be able to inject markup into the owner's own panel.
  for (const r of replies) {
    const row = doc.createElement('div');
    row.className = 'ema-row kami-reply';
    row.dataset.replyId = String(r.id || '');

    const stud = doc.createElement('div');
    stud.className = 'ema-stud kami-reply-stud';
    stud.textContent = '⛩';

    const main = doc.createElement('div');
    main.className = 'ema-main';
    if (r.quote) {
      const q = doc.createElement('div');
      q.className = 'ema-quote';
      q.textContent = '› ' + r.quote;
      main.appendChild(q);
    }
    const note = doc.createElement('div');
    note.className = 'ema-note';
    note.textContent = r.text || '';
    const meta = doc.createElement('div');
    meta.className = 'ema-meta';
    meta.textContent = formatTime(r.ts) + (r.ref ? ' · re ' + String(r.ref).slice(0, 8) : '');
    main.appendChild(note);
    main.appendChild(meta);

    row.appendChild(stud);
    row.appendChild(main);
    body.appendChild(row);
  }

  for (const rec of rows) {
    const row = doc.createElement('div');
    row.className = rec.status === EMA_STATUS.RESOLVED ? 'ema-row resolved' : 'ema-row';
    row.dataset.emaId = rec.id;
    row.title = rec.note || '';

    const stud = doc.createElement('div');
    stud.className = 'ema-stud';

    const main = doc.createElement('div');
    main.className = 'ema-main';
    const note = doc.createElement('div');
    note.className = 'ema-note';
    // textContent, never innerHTML: notes are free text typed by a human and
    // must never be able to inject markup into the owner's own panel.
    note.textContent = rec.note || '';
    const meta = doc.createElement('div');
    meta.className = 'ema-meta';
    meta.textContent = metaLine(rec);
    main.appendChild(note);
    main.appendChild(meta);

    row.appendChild(stud);
    row.appendChild(main);

    const url = opts.shotUrl ? opts.shotUrl(rec) : null;
    if (url) {
      const img = doc.createElement('img');
      img.className = 'ema-shot';
      img.src = url;
      img.alt = '';
      row.appendChild(img);
    }

    if (opts.onSelect) row.addEventListener('click', () => opts.onSelect(rec));
    body.appendChild(row);
  }
  return rows.length;
}

/**
 * Show the rack. `floating` switches it from a menu column to a pane hanging off
 * the right edge over the 3D world.
 */
export function showEmagake({ doc = document, floating = false } = {}) {
  const el = doc.getElementById('emagake');
  if (!el) return false;
  el.classList.toggle('floating', !!floating);
  el.removeAttribute('hidden');
  return true;
}

export function hideEmagake({ doc = document } = {}) {
  const el = doc.getElementById('emagake');
  if (el) el.setAttribute('hidden', '');
}
