// tools/toriiQuestDashboardParse.mjs — PURE, node-safe markdown PARSER for the Torii Quest
// dashboard (v0.2.174). Reduces the curated copy in
// `src/engine/dashboard/toriiQuestData.js` by DERIVING the dashboard's list sections
// (next-12 / active-now / completed-24h / archive clusters) and a small set of task
// counts from `torii-quest-progress.md` + `torii-quest-todo.md` at BUILD time. Build/dev tooling only — NEVER
// imported by the game and NEVER by toriiQuestData.js (which stays browser-bundle-safe);
// the CLI (tools/build-torii-quest-dashboard.mjs) does the fs reads and hands plain STRINGS to these
// helpers, which return plain data. NO fs/network/THREE/DOM/crypto in here.
//
// Robust-and-safe by design (per the work order): parse only simple, stable patterns
// (level-2 headings + numbered lists + struck/plain bullets). Anything that does not
// parse cleanly is reported in `gaps` and the caller keeps the curated default — the
// dashboard never shows an empty/garbled section because a doc heading was renamed.
// Source-of-truth split is preserved: torii-quest-todo.md owns tasks, torii-quest-strategy.md owns vision,
// torii-quest-progress.md is the dashboard source document this reads.

// stripInlineMd(s) — remove the inline markdown emphasis that would otherwise leak into
// the escaped dashboard text (**bold**, ~~strike~~, `code`). Pure, never throws.
export function stripInlineMd(value) {
  return String(value == null ? '' : value)
    .replace(/\*\*/g, '')
    .replace(/~~/g, '')
    .replace(/`/g, '')
    .trim();
}

// cleanBullet(s) — normalise a bullet/list item to display text: strip inline markdown,
// then drop a single leading status glyph run (e.g. the "🔄 " / "✅ " progress emoji)
// so an "Active now" line reads from its first real word. Pure.
export function cleanBullet(value) {
  const t = stripInlineMd(value);
  return t.replace(/^[^0-9A-Za-z]+/, '').trim();
}

// sectionLines(md, headingPrefix) — the lines BETWEEN a `## <headingPrefix…>` heading and
// the next level-1/2 heading, or null when no matching heading exists. Case-insensitive,
// prefix match (so "Next 12 tasks" finds "## Next 12 tasks"). Pure.
export function sectionLines(md, headingPrefix) {
  const lines = String(md == null ? '' : md).split(/\r?\n/);
  const want = String(headingPrefix || '').trim().toLowerCase();
  if (!want) return null;
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^##\s+(.*)$/.exec(lines[i]);
    if (m && m[1].trim().toLowerCase().startsWith(want)) { start = i; break; }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let j = start + 1; j < lines.length; j += 1) {
    if (/^#{1,2}\s+/.test(lines[j])) { end = j; break; }
  }
  return lines.slice(start + 1, end);
}

// parseNumberedList(md, headingPrefix) — display strings from `N. text` items in a section.
export function parseNumberedList(md, headingPrefix) {
  const section = sectionLines(md, headingPrefix);
  if (!section) return [];
  const out = [];
  for (const line of section) {
    const m = /^\s*\d+\.\s+(.*\S)\s*$/.exec(line);
    if (m) {
      const text = cleanBullet(m[1]);
      if (text) out.push(text);
    }
  }
  return out;
}

// parseStruckBullets(md, headingPrefix) — display strings from `- ~~text~~` items (the
// struck "completed last 24h" one-liners). Pure.
export function parseStruckBullets(md, headingPrefix) {
  const section = sectionLines(md, headingPrefix);
  if (!section) return [];
  const out = [];
  for (const line of section) {
    const m = /^\s*[-*]\s+~~([\s\S]*?)~~\s*$/.exec(line);
    if (m) {
      const text = cleanBullet(m[1]);
      if (text) out.push(text);
    }
  }
  return out;
}

// parseBullets(md, headingPrefix) — display strings from `- text` items in a section
// (used for "Active now" + the "Archive" clusters). Skips struck items (those have their
// own parser) and sub-indented continuation lines. Pure.
export function parseBullets(md, headingPrefix) {
  const section = sectionLines(md, headingPrefix);
  if (!section) return [];
  const out = [];
  for (const line of section) {
    if (/^\s*[-*]\s+~~/.test(line)) continue; // struck → not here
    const m = /^[-*]\s+(.*\S)\s*$/.exec(line); // top-level bullet only (no leading indent)
    if (m) {
      const text = cleanBullet(m[1]);
      if (text) out.push(text);
    }
  }
  return out;
}

// countStruck(md) — number of `~~…~~` struck spans in a doc (a robust proxy for completed
// task markers in torii-quest-todo.md). Pure.
export function countStruck(md) {
  const matches = String(md == null ? '' : md).match(/~~[^~]+~~/g);
  return matches ? matches.length : 0;
}

// deriveToriiQuestData({ progressMd, todoMd }) → { overrides, taskTotals, parsed, gaps }.
// PURE. `overrides` carries ONLY the sections that parsed cleanly (the caller merges them
// over the curated CONTINUUM defaults); a section that fails to parse is recorded in
// `gaps` and omitted, so the curated default survives. `taskTotals` is a small, clearly
// DERIVED set of counts for an at-a-glance "docs-derived" metric. Bounds keep an oddly
// formatted doc from producing an absurd list.
export function deriveToriiQuestData(docs = {}) {
  const progressMd = String(docs.progressMd || '');
  const todoMd = String(docs.todoMd || '');
  const overrides = {};
  const parsed = [];
  const gaps = [];

  const tryList = (key, items, { min = 1, max = 40 } = {}) => {
    if (items.length >= min && items.length <= max) {
      overrides[key] = items;
      parsed.push(`${key} (${items.length})`);
      return items.length;
    }
    gaps.push(`${key}: no usable items parsed from torii-quest-progress.md — kept curated default`);
    return null;
  };

  const next12 = tryList('next12', parseNumberedList(progressMd, 'Next 12 tasks'), { max: 24 });
  // activeNow/completed24h are running logs in torii-quest-progress.md — each shipped slice prepends an
  // entry, so the realistic list lengths far exceed the original v0.2.174 guard ceilings.
  // The bounds still exist to reject an absurd/garbled section; they are raised to fit the
  // intended running-log format so the dashboard derives from torii-quest-progress.md instead of falling
  // back to the curated default (the gap the v0.2.208 cleanup closed).
  const activeNow = tryList('activeNow', parseBullets(progressMd, 'Active now'), { max: 60 });
  const completed24h = tryList('completed24h', parseStruckBullets(progressMd, 'Completed last 24h'), { max: 60 });
  const archive = tryList('archive', parseBullets(progressMd, 'Archive'), { max: 40 });

  const todoCompletedMarkers = countStruck(todoMd);
  if (!todoMd) gaps.push('torii-quest-todo.md: empty/unreadable — completed-task count unavailable');

  const taskTotals = {
    isDerived: true,
    todoCompletedMarkers,
    next12: next12 == null ? null : next12,
    activeNow: activeNow == null ? null : activeNow,
    completed24h: completed24h == null ? null : completed24h,
    archiveClusters: archive == null ? null : archive,
  };

  return { overrides, taskTotals, parsed, gaps };
}

// summariseTaskTotals(taskTotals) — one-line human summary for the dashboard's derived
// metric row. Pure, safe on a null/partial input.
export function summariseTaskTotals(taskTotals) {
  if (!taskTotals) return '';
  const parts = [];
  if (taskTotals.todoCompletedMarkers != null) parts.push(`${taskTotals.todoCompletedMarkers} completed task markers (torii-quest-todo.md)`);
  if (taskTotals.next12 != null) parts.push(`${taskTotals.next12} next-12`);
  if (taskTotals.archiveClusters != null) parts.push(`${taskTotals.archiveClusters} archive clusters`);
  return parts.join(' · ');
}
