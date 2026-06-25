// engine/dashboard/continuumData.js — Torii Continuum project-oversight DASHBOARD
// data + pure renderer (v0.2.171). This is the FIRST slice of a broader project
// oversight surface. It turns the curated state kept in `progress.md` into a small,
// node-safe data model, computes headline totals/percentages, and renders it to a
// self-contained static HTML page string.
//
// Source-of-truth split (preserved, and surfaced on the page itself):
//   - `todo.md`      owns the active TASK queue (task source of truth).
//   - `strategy.md`  owns VISION / decision rules (strategy source of truth).
//   - `progress.md`  is the visual execution DASHBOARD source document — the data
//                    below is curated from it.
//
// Refresh model: the generator (`tools/build-continuum.mjs`) writes BOTH the page
// (`public/continuum.html`) and a packaged data file (`public/continuum-data.json`)
// from this module at build/deploy time, so each deploy — and the page refresh
// after it — shows the latest PACKAGED project state. The page renders fully WITHOUT
// JavaScript; a tiny, optional, same-origin-only refresh script re-reads the packaged
// JSON to update the live totals strip (no external URL, no eval, no timers).
//
// Constrained by construction:
//   - Pure + node-safe: NO THREE/Rapier/DOM/fs/network imports; renders to a STRING.
//   - READ-ONLY oversight: NO live writes, auth, signing, NIP-07, relay publish,
//     payments, or auto-update. Every text value is HTML-escaped; the only link is
//     the project's OWN live URL, shown as plain text (no external redirect). A
//     nostrich could read it from a cold cache and nothing would fire.
//   - Contributors/clankers is a clearly-flagged SEED metric, not live data.
//   - Curated/static data is the FALLBACK; it is isolated in CONTINUUM below. As of
//     v0.2.174 the generator (tools/build-continuum.mjs + tools/continuumParse.mjs)
//     DERIVES the list sections (next-12 / active-now / completed-24h / archive) and a
//     "docs-derived" task-count metric from progress.md + todo.md at build time and
//     passes them to buildContinuumModel(overrides). Anything that fails to parse falls
//     back to the curated values below, so the page never shows an empty/garbled section.

export const CONTINUUM_VERSION = 'v0.2.174-alpha';
export const CONTINUUM_BADGE = 'PROJECT OVERSIGHT · STATIC · READ-ONLY';

// CONTINUUM_REFRESH_SCRIPT (v0.2.172) — the EXACT inline-script body the page ships,
// kept as the single source of that text so its CSP hash can never silently drift.
// It is STATIC (no model interpolation), so its sha256 is stable across deploys: a
// page refresh re-reads the packaged SAME-ORIGIN JSON to update the totals strip.
// No external URL, no eval, no timers — degrades silently on any failure. The page
// renders fully WITHOUT this script; it is pure progressive enhancement.
export const CONTINUUM_REFRESH_SCRIPT = `
  // Best-effort refresh from the packaged SAME-ORIGIN data file. No external URL,
  // no eval, no timers — silently keeps the server-rendered values on any failure.
  (function(){
    try{
      fetch('./continuum-data.json',{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).then(function(d){
        if(!d||!d.totals)return;
        var map={tasksAhead:d.totals.tasksAhead,activeTasks:d.totals.activeTasks,completedLast24h:d.totals.completedLast24h,archivedClusters:d.totals.archivedClusters,trackCount:d.totals.trackCount,milestones:(d.totals.milestonesAchieved+' / '+d.totals.milestoneCount)};
        Object.keys(map).forEach(function(k){var el=document.querySelector('[data-k="'+k+'"]');if(el&&map[k]!=null)el.textContent=map[k];});
        var g=document.getElementById('generated-at');if(g&&d.generatedAt)g.textContent=d.generatedAt;
      }).catch(function(){});
    }catch(e){}
  })();
  `;

// CONTINUUM_SCRIPT_SHA256 (v0.2.172) — base64 sha256 of CONTINUUM_REFRESH_SCRIPT, in
// the `'sha256-…'` source-expression form a CSP `script-src` consumes. Hardcoded
// (this module stays crypto-free so it remains node- AND browser-bundle-safe, like
// the hash in index.html); `tests/continuum-dashboard.test.js` recomputes it with
// node:crypto and FAILS the build if the script body and this constant ever diverge.
export const CONTINUUM_SCRIPT_SHA256 = "sha256-otKqhP2RYAA6ZkrRVcAQSBm7B1ssPR70QQR5dXePHmw=";

// CONTINUUM_CSP (v0.2.172) — strict Content-Security-Policy for the generated
// dashboard, resolving the prior "inline script with no CSP" WARN:
//   - script-src 'self' + the script hash → NO 'unsafe-inline' for script (the XSS
//     surface is closed); only the one packaged refresh script may run.
//   - style-src 'self' 'unsafe-inline' → the static <style> block AND the data-driven
//     `style="width:N%"` track-bar attributes keep working. Inline STYLE ATTRIBUTES
//     cannot be element-hashed, and adding any style hash would disable 'unsafe-inline'
//     and break the bars; style injection cannot execute script, so this is the
//     maintainable low-risk choice.
//   - connect-src 'self' → ONLY the same-origin continuum-data.json refresh; no relay,
//     no external API.
//   - default-src 'self'; object-src/base-uri/form-action/frame-ancestors locked down
//     → no plugins, no <base> hijack, no form posting, no framing.
export const CONTINUUM_CSP =
  "default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'; " +
  "frame-ancestors 'none'; img-src 'self'; connect-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; " +
  `script-src 'self' '${CONTINUUM_SCRIPT_SHA256}'`;

// Curated snapshot of progress.md (the dashboard source document). Keep this the
// ONLY place the curated copy lives so future automation has a single seam.
export const CONTINUUM = Object.freeze({
  version: CONTINUUM_VERSION,
  title: 'Torii Continuum',
  subtitle: 'Project oversight dashboard',
  liveUrl: 'torii-quest.pplx.app',
  focus: '15-hour proof-of-concept route — shooter is maintenance-only unless ' +
    'demo-breaking; the active MVP is the freedom-tech loop (gateway/NAP-to-NAP ' +
    'preview → Plebeian/Nostr product panel → leaderboard preview → torii.quest ' +
    'update-check). Polish comes after PoC validation.',

  // "At a glance" metrics.
  metrics: [
    { label: 'Source version', value: 'v0.2.174-alpha (build truth; live trails — manual deploy)' },
    { label: 'Tests', value: '812+ passing / 60+ files (profiles: test:fast ~5, test:foundation ~17)' },
    { label: 'Regression check', value: '14 / 14 GREEN' },
    { label: 'Bundle (advisory)', value: '~2.9 MB raw / ~1018 KB gzip (rapier chunk >700 KB, expected)' },
    { label: 'Gates', value: 'SEC-1 / SEC-2 / SEC-3 intact · godMode false · continuum CSP enforced' },
    { label: 'Active slice', value: 'v0.2.174 dashboard data automation (derive lists from progress.md/todo.md)' },
  ],

  // Contributors / clankers — SEED placeholder, NOT live data. "clankers" are the
  // AI coding agents (Claude / GPT / DeepSeek) the handoff loop is built around.
  contributors: { isSeed: true, humans: 1, clankers: 3, note: 'Seed placeholder — not live Nostr/contributor data.' },

  // Track Overview — percent is directional, not archaeology.
  tracks: [
    { name: 'Foundation / ARS', percent: 71, done: '5 / 7', status: 'ARS-4 (FSM fold) + ARS-6 (CODE_INDEX upkeep) open' },
    { name: 'Combat / Game-feel', percent: 100, done: '30 / 30', status: '1 open edge (travel-time lead on moving targets)' },
    { name: 'Rapier / Physics', percent: 100, done: '5 / ~5 seams', status: 'ARS-3 raycast migration complete' },
    { name: 'SDK / API', percent: 86, done: '18 / ~21', status: 'player boundary lift + BotAgent runtime remain' },
    { name: 'Nostr / Open-world', percent: 15, done: '0 / 5+', status: 'read-paths + consent gate + travel chain proven; relays/signing deferred' },
    { name: 'Deployment / VPS', percent: null, done: '—', status: 'source clean; live behind (manual deploy)' },
  ],

  // 15-Hour Proof-of-Concept Route (MVP loop). `state` drives milestone counts;
  // `progress` is a directional estimate used only for the aggregate PoC ring.
  leanRoute: [
    { id: 'LEAN-1', state: 'pending', progress: 20, slice: 'Torii.quest live (publish green source)', status: 'pending (manual smoke first)' },
    { id: 'LEAN-2', state: 'in-progress', progress: 70, slice: 'Gateway / NAP-to-NAP travel', status: 'chain proven through the host transport adapter (170); needs createBrowserHostTransport(window) wired into world/handoff.js + portal mesh to ACT' },
    { id: 'LEAN-3', state: 'in-progress', progress: 45, slice: 'Plebeian/Nostr product panel', status: 'shells + visible preview; needs in-world mesh + real listing' },
    { id: 'LEAN-4', state: 'in-progress', progress: 40, slice: 'Leaderboard (Nostr signed events)', status: 'unsigned helpers + publisher adapter + view + relay-read proof; needs real signer (SEC-1) + relay read' },
    { id: 'LEAN-5', state: 'in-progress', progress: 55, slice: 'torii.quest GitHub update-check', status: 'helper + view-model + release source/status; needs read-only releases fetch + prompt mesh' },
  ],

  // Now / Next / Later.
  activeNow: [
    'v0.2.174 — dashboard data automation: the continuum page now DERIVES its next-12 / active-now / completed-24h / archive lists + a docs-derived task-count metric from progress.md + todo.md at build time, falling back to curated defaults on any parse gap.',
    'ARS-4 — finish folding reload/pointer-lock into the guarded FSM.',
    'ARS-6 / PROGRESS-1 — ongoing CODE_INDEX + living-docs upkeep.',
  ],

  next12: [
    'Wire createBrowserHostTransport(window) (v0.2.170) into world/handoff.js (real router/history adapter + same-origin allowlist + CSP) so the v0.2.168 executor can ACT.',
    'Gateway portal mesh — actually move the player in-world on a confirmed hop.',
    'SEC-2 handoff verification gate — cryptographic checks before acting on live relay travel intents.',
    'Real leaderboard signer/publisher + relay read (SEC-1 explicit NIP-07 consent first).',
    'In-world product panel mesh over productPanelShell + a real Plebeian.Market listing.',
    'SEC-3 product URL validation — URL-object parsing (scheme+host), not regex-only.',
    'Read-only GitHub releases fetch (CSP-scoped) + in-world update-prompt mesh.',
    'LEAN-1 / TQ-MANUAL-113 — manual smoke on real hardware, then publish source-built artifact.',
    'ARS-4 FSM fold close-out.',
    'Player boundary full extraction (movement tick, combat, lifecycle, body-state behind the seam).',
    'BotAgent runtime migration — wire decideActions, migrate stateful tick/shoot/blowback.',
    'Formalise NAP zone registry for the gateway/NAP-to-NAP travel preview.',
  ],

  risks: [
    { item: 'Foundation / docs / tooling slices', state: 'no-blocker', note: 'Pure node-safe, no deploy needed — the current cadence.' },
    { item: 'Gateway-travel chain (read→execute)', state: 'no-blocker', note: 'All PURE & INERT; never navigates/signs/publishes/writes network.' },
    { item: 'Live relay I/O · signing · world hop', state: 'gated', note: 'SEC-1/2/3 must clear before any wire write or live navigation.' },
    { item: 'Live deployment', state: 'manual', note: 'Trails source; needs maintainer smoke + publish (LEAN-1).' },
    { item: 'Travel-time lead on fast targets', state: 'open-edge', note: 'Hitscan-aimed but projectile-flown; long shots on strafing bots can trail.' },
    { item: 'ESBUILD-1 dev-server advisory', state: 'deferred', note: 'npm audit fix pulls a risky rolldown/vite chain; tracked WARN.' },
  ],

  // Completed last 24h — shown struck through, newest first.
  completed24h: [
    'v0.2.174 — dashboard DATA AUTOMATION: pure tools/continuumParse.mjs parses progress.md + todo.md at build time so the continuum page DERIVES its next-12 / active-now / completed-24h / archive lists + a docs-derived task-count metric; buildContinuumModel(overrides) merges them over the curated fallback (safe fallback + parser-gap reporting on any miss). CSP unchanged. +tests.',
    'v0.2.173 — TEST-PROFILE system for faster agent loops: npm run test:fast (~5 core files) + test:foundation (~16 pure/guard files) for inner loops, test:release = FULL suite + check/build/bundle/handoff (release gate unchanged). Explicit curated lists (tools/testProfiles.mjs, no git-diff heuristics) validated against disk + a timing footer. +11 tests.',
    'v0.2.172 — Continuum dashboard CSP HARDENING: strict Content-Security-Policy meta on the generated page (script-src self + sha256 of the one packaged refresh script, NO unsafe-inline script; style-src self unsafe-inline for the data-driven bars; connect-src self for the same-origin JSON refresh). Resolves the prior inline-script WARN; page stays fully static/read-only.',
    'v0.2.171 — Torii Continuum project-oversight DASHBOARD: a thin static page (public/continuum.html) generated from a curated, node-safe progress.md data model (engine/dashboard/continuumData.js) — bars/rings/totals, Now/Next/Later, next-12, struck completed-24h, archive; docs/tooling only, no gameplay change.',
  ],

  // Archive clusters, newest first.
  archive: [
    'v0.2.164–167 — gateway travel chain foundation: relay-read proof → travel confirm/intent → consent UX view-model → dry-run handoff plan (all PURE & INERT).',
    'v0.2.159–163 — read-only Nostr foundation: relay-read + leaderboard/profile reads + consent-gate foundation + leaderboard submit intent.',
    'v0.2.147–158 — proof-surface pipeline + update-check source/panel: spec layer → cross-check → anchor→transform contract → first in-world mesh pass → promotion/regression gate; GitHub release-check source + update-status panel.',
    'v0.2.138–146 — MVP loop made visible + docs symmetry: pivot to the 15-hour PoC route; four inert title-screen preview cards; self-hosting guide + debug index + diff checklist.',
    'v0.2.134–137 — lean-MVP foundation: Gateway Protocol draft + travelIntent; product display; leaderboard helpers; registry; view shells; hardening + shellReport.',
    'v0.2.120–133 — SDK + components + test harness: Vitest; event bus + FSM slices; ToriiDebug; pure physics/raycast/combat seams; SDK entrypoint + stability tiers; component contract; first reference component; real GAMEOVER edge.',
    'v0.2.100–119 — reconciliation & game-feel + decoupling: source reconciled by concern; physics SDK seams; regression batches; CSP + avatar-URL hardening; globals moved onto the event bus / module registries.',
  ],

  sourceOfTruth: [
    'todo.md remains the active TASK queue (task source of truth).',
    'strategy.md remains VISION / decision rules (strategy source of truth).',
    'progress.md remains the visual execution DASHBOARD source document — this page is curated from it.',
  ],
});

// ---- pure helpers ---------------------------------------------------------

// escapeHtml(s) — minimal, safe HTML-text escaping so curated strings can never
// inject markup/script into the rendered page. Pure, never throws.
export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// clampPct(n) — integer 0..100, or null for null/NaN (so an "n/a" track shows).
export function clampPct(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  const v = Math.round(Number(n));
  return v < 0 ? 0 : v > 100 ? 100 : v;
}

// barCells(percent, width=20) — directional bar split into filled/empty cell counts.
// `percent` null → all-empty (used for the n/a Deployment track). Clamped. Pure.
export function barCells(percent, width = 20) {
  const w = Math.max(1, Math.floor(width));
  const p = clampPct(percent);
  if (p == null) return { filled: 0, empty: w, percent: null };
  const filled = Math.round((p / 100) * w);
  return { filled, empty: w - filled, percent: p };
}

// ringDash(pct, circumference) — stroke-dasharray for an SVG progress ring:
// `${filled} ${rest}`. Pure geometry, no DOM.
export function ringDash(pct, circumference) {
  const p = clampPct(pct) || 0;
  const filled = (circumference * p) / 100;
  return { filled, rest: circumference - filled };
}

function _average(nums) {
  const valid = nums.filter((n) => typeof n === 'number' && !Number.isNaN(n));
  if (!valid.length) return 0;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

// computeTotals(data) — headline counts + percentages derived from the curated
// data. Pure. milestonesAchievedPct counts only state==='done' (honest, can be 0);
// pocProgressPct is the directional mean of milestone progress; buildProgressPct
// is the mean of the numeric (non-null) track percents.
export function computeTotals(data = CONTINUUM) {
  const lean = data.leanRoute || [];
  const tracks = data.tracks || [];
  const milestoneCount = lean.length;
  const milestonesAchieved = lean.filter((l) => l.state === 'done').length;
  const milestonesInProgress = lean.filter((l) => l.state === 'in-progress').length;
  return {
    tasksAhead: (data.next12 || []).length,
    activeTasks: (data.activeNow || []).length,
    completedLast24h: (data.completed24h || []).length,
    archivedClusters: (data.archive || []).length,
    trackCount: tracks.length,
    milestoneCount,
    milestonesAchieved,
    milestonesInProgress,
    milestonesAchievedPct: milestoneCount ? Math.round((milestonesAchieved / milestoneCount) * 100) : 0,
    pocProgressPct: _average(lean.map((l) => clampPct(l.progress) || 0)),
    buildProgressPct: _average(tracks.map((t) => clampPct(t.percent)).filter((v) => v != null)),
  };
}

// buildContinuumModel(overrides) — curated data MERGED with optional build-time overrides
// (v0.2.174), plus per-track bar cells + computed totals. Pure (no mutation of CONTINUUM);
// the single entry point the renderer + tests use. `overrides` may carry derived list
// sections (next12/activeNow/completed24h/archive) that REPLACE the curated arrays, plus
// two meta fields pulled out before the merge: `taskTotals` (the docs-derived metric) and
// `derived` (parser provenance). With NO overrides it returns exactly the curated model,
// so the existing tests + the no-JS fallback are unchanged.
export function buildContinuumModel(overrides = {}) {
  const { taskTotals = null, derived = null, ...dataOverrides } = overrides || {};
  const base = { ...CONTINUUM, ...dataOverrides };
  return {
    ...base,
    badge: CONTINUUM_BADGE,
    generatedAt: base.generatedAt || null,
    tracks: (base.tracks || []).map((t) => ({ ...t, bar: barCells(t.percent) })),
    totals: computeTotals(base),
    taskTotals,
    derived,
  };
}

// continuumDataJSON(model) — the packaged, JSON-serialisable snapshot the generator
// writes to public/continuum-data.json. Pure; safe to JSON.stringify.
export function continuumDataJSON(model = buildContinuumModel()) {
  return {
    version: model.version,
    generatedAt: model.generatedAt || null,
    badge: model.badge,
    totals: model.totals,
    contributors: model.contributors || null,
    taskTotals: model.taskTotals || null,
    derived: model.derived || null,
  };
}

// ---- HTML render fragments -------------------------------------------------

const _li = (items) => items.map((x) => `        <li>${escapeHtml(x)}</li>`).join('\n');

function _metricRows(metrics) {
  return metrics.map((m) =>
    `        <div class="metric"><span class="metric-label">${escapeHtml(m.label)}</span><span class="metric-value">${escapeHtml(m.value)}</span></div>`
  ).join('\n');
}

function _totalsStrip(totals) {
  const cells = [
    ['tasks ahead', totals.tasksAhead, 'tasksAhead'],
    ['active', totals.activeTasks, 'activeTasks'],
    ['done (24h)', totals.completedLast24h, 'completedLast24h'],
    ['archive clusters', totals.archivedClusters, 'archivedClusters'],
    ['tracks', totals.trackCount, 'trackCount'],
    ['milestones', `${totals.milestonesAchieved} / ${totals.milestoneCount}`, 'milestones'],
  ];
  return cells.map(([lbl, val, key]) =>
    `        <div class="tot"><span class="tot-v" data-k="${escapeHtml(key)}">${escapeHtml(val)}</span><span class="tot-l">${escapeHtml(lbl)}</span></div>`
  ).join('\n');
}

function _donut(pct, label, sub) {
  const C = 326.726; // 2π·52
  const { filled, rest } = ringDash(pct, C);
  const p = clampPct(pct) || 0;
  return `        <figure class="donut">
          <svg viewBox="0 0 120 120" role="img" aria-label="${escapeHtml(label)} ${p} percent">
            <circle class="donut-track" cx="60" cy="60" r="52"></circle>
            <circle class="donut-val" cx="60" cy="60" r="52" stroke-dasharray="${filled.toFixed(2)} ${rest.toFixed(2)}" transform="rotate(-90 60 60)"></circle>
            <text class="donut-num" x="60" y="58">${p}%</text>
            <text class="donut-lbl" x="60" y="78">${escapeHtml(sub || '')}</text>
          </svg>
          <figcaption>${escapeHtml(label)}</figcaption>
        </figure>`;
}

function _rings(totals) {
  return [
    _donut(totals.pocProgressPct, 'PoC / vision progress', 'estimate'),
    _donut(totals.buildProgressPct, 'Build progress', 'tracks'),
    _donut(totals.milestonesAchievedPct, 'Milestones achieved', `${totals.milestonesAchieved}/${totals.milestoneCount}`),
  ].join('\n');
}

function _trackRows(tracks) {
  return tracks.map((t) => {
    const pctLabel = t.bar.percent == null ? 'n/a' : `${t.bar.percent}%`;
    const fillW = t.bar.percent == null ? 0 : t.bar.percent;
    return `        <div class="track">
          <div class="track-head"><span class="track-name">${escapeHtml(t.name)}</span><span class="track-pct">${escapeHtml(pctLabel)} · ${escapeHtml(t.done)}</span></div>
          <div class="bar"><div class="bar-fill" style="width:${fillW}%"></div></div>
          <div class="track-status">${escapeHtml(t.status)}</div>
        </div>`;
  }).join('\n');
}

function _leanRows(rows) {
  return rows.map((r) =>
    `        <tr><td class="lean-id">${escapeHtml(r.id)}</td><td>${escapeHtml(r.slice)}</td><td>${escapeHtml(r.status)}</td></tr>`
  ).join('\n');
}

function _riskRows(rows) {
  return rows.map((r) =>
    `        <tr><td>${escapeHtml(r.item)}</td><td><span class="pill pill-${escapeHtml(r.state)}">${escapeHtml(r.state)}</span></td><td>${escapeHtml(r.note)}</td></tr>`
  ).join('\n');
}

// renderContinuumPage(model) — full self-contained static HTML document string.
// Dark Torii/nostrich/cyberpunk feel via inline CSS only; CSS bars + SVG rings.
// The page renders fully WITHOUT JavaScript. A tiny, optional, same-origin-only
// script re-reads ./continuum-data.json to refresh the totals strip (no external
// URL, no eval, no timers; degrades silently). Pure; safe to write to a file.
export function renderContinuumPage(model = buildContinuumModel()) {
  const m = model;
  const t = m.totals;
  const contrib = m.contributors
    ? `        <div class="metric"><span class="metric-label">Contributors <span class="seed">SEED · not live</span></span><span class="metric-value">${escapeHtml(m.contributors.humans)} human · ${escapeHtml(m.contributors.clankers)} clankers</span></div>`
    : '';
  const tt = m.taskTotals;
  const derivedRow = tt
    ? `        <div class="metric"><span class="metric-label">Docs-derived <span class="seed">DERIVED · build-time</span></span><span class="metric-value">${escapeHtml(
        [
          tt.todoCompletedMarkers != null ? `${tt.todoCompletedMarkers} completed task markers (todo.md)` : null,
          t.tasksAhead != null ? `${t.tasksAhead} next-12` : null,
          t.archivedClusters != null ? `${t.archivedClusters} archive clusters` : null,
        ].filter(Boolean).join(' · ')
      )}</span></div>`
    : '';
  const derivedNote = m.derived && Array.isArray(m.derived.parsed)
    ? `    Dashboard lists generated from <b>${escapeHtml((m.derived.sources || []).join(' + ') || 'project docs')}</b> at build time — parsed: ${escapeHtml(m.derived.parsed.join(', ') || 'none')}${m.derived.gaps && m.derived.gaps.length ? `; fell back to curated for: ${escapeHtml(String(m.derived.gaps.length))} section(s)` : '; no parser gaps'}.`
    : '';
  const next12 = m.next12.map((x, i) =>
    `        <li><span class="num">${i + 1}</span>${escapeHtml(x)}</li>`
  ).join('\n');
  const done24 = m.completed24h.map((x) => `        <li class="done">${escapeHtml(x)}</li>`).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${CONTINUUM_CSP}" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(m.title)} · ${escapeHtml(m.version)}</title>
<style>
  :root{
    --bg:#070a12; --panel:#0d1320; --panel2:#111a2b; --edge:#1d2a44;
    --ink:#dbe4f3; --muted:#8b97b0; --hot:#ff5a4d; --accent:#36e0c8;
    --gold:#e8b84b; --good:#46d17a; --warn:#e8b84b; --bad:#ff5a4d;
  }
  *{box-sizing:border-box;}
  body{margin:0;background:radial-gradient(1200px 600px at 70% -10%, #16213a 0%, var(--bg) 60%);
    color:var(--ink);font:14px/1.55 ui-monospace,Menlo,Consolas,monospace;padding:0 0 64px;}
  header{padding:28px 22px 16px;border-bottom:1px solid var(--edge);
    background:linear-gradient(180deg,rgba(54,224,200,.06),transparent);}
  .gate{color:var(--hot);letter-spacing:3px;font-size:12px;}
  h1{margin:6px 0 2px;font-size:26px;letter-spacing:2px;}
  h1 .v{color:var(--accent);font-size:15px;letter-spacing:1px;}
  .sub{color:var(--muted);letter-spacing:1px;}
  .badge{display:inline-block;margin-top:10px;padding:3px 10px;border:1px solid var(--edge);
    border-radius:3px;color:var(--accent);font-size:11px;letter-spacing:2px;}
  .live{color:var(--muted);font-size:12px;margin-top:6px;}
  main{max-width:1040px;margin:0 auto;padding:0 16px;}
  section{margin-top:26px;}
  h2{font-size:13px;letter-spacing:3px;color:var(--gold);text-transform:uppercase;
    border-left:3px solid var(--hot);padding-left:10px;margin:0 0 12px;}
  .focus{background:var(--panel);border:1px solid var(--edge);border-radius:6px;
    padding:12px 14px;color:var(--muted);margin-top:14px;}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;}
  .metric{background:var(--panel);border:1px solid var(--edge);border-radius:6px;
    padding:10px 12px;display:flex;flex-direction:column;gap:3px;}
  .metric-label{color:var(--muted);font-size:11px;letter-spacing:1px;text-transform:uppercase;}
  .metric-value{color:var(--ink);}
  .seed{color:var(--gold);font-size:9px;border:1px solid var(--gold);border-radius:4px;padding:0 4px;letter-spacing:1px;}
  .totals{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-top:12px;}
  .tot{text-align:center;background:var(--panel);border:1px solid var(--edge);border-radius:6px;padding:12px 6px;}
  .tot-v{display:block;font-size:24px;color:var(--accent);}
  .tot-l{font-size:10px;color:var(--muted);letter-spacing:1px;text-transform:uppercase;}
  .rings{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:12px;}
  .donut{margin:0;text-align:center;background:var(--panel);border:1px solid var(--edge);border-radius:6px;padding:8px 4px;}
  .donut svg{width:130px;height:130px;}
  .donut-track{fill:none;stroke:#16213a;stroke-width:10;}
  .donut-val{fill:none;stroke:var(--accent);stroke-width:10;stroke-linecap:round;}
  .donut-num{fill:var(--ink);font-size:22px;text-anchor:middle;font-family:inherit;}
  .donut-lbl{fill:var(--muted);font-size:8px;text-anchor:middle;letter-spacing:1px;font-family:inherit;}
  .donut figcaption{color:var(--muted);font-size:11px;letter-spacing:1px;margin-top:2px;}
  .track{background:var(--panel);border:1px solid var(--edge);border-radius:6px;padding:10px 12px;margin-bottom:8px;}
  .track-head{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;}
  .track-name{letter-spacing:1px;}
  .track-pct{color:var(--accent);font-size:12px;}
  .track-status{color:var(--muted);font-size:12px;margin-top:4px;}
  .bar{height:10px;background:var(--panel2);border:1px solid var(--edge);border-radius:5px;
    overflow:hidden;margin-top:7px;}
  .bar-fill{height:100%;background:linear-gradient(90deg,var(--hot),var(--gold) 60%,var(--accent));}
  table{width:100%;border-collapse:collapse;background:var(--panel);
    border:1px solid var(--edge);border-radius:6px;overflow:hidden;}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--edge);vertical-align:top;font-size:13px;}
  th{color:var(--muted);font-size:11px;letter-spacing:2px;text-transform:uppercase;}
  tr:last-child td{border-bottom:none;}
  .lean-id{color:var(--accent);white-space:nowrap;}
  .pill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;letter-spacing:1px;border:1px solid var(--edge);}
  .pill-no-blocker{color:var(--good);border-color:var(--good);}
  .pill-gated,.pill-manual{color:var(--warn);border-color:var(--warn);}
  .pill-open-edge,.pill-deferred{color:var(--muted);}
  ul{list-style:none;padding:0;margin:0;}
  ul.bullets li{background:var(--panel);border:1px solid var(--edge);border-radius:6px;
    padding:8px 11px;margin-bottom:7px;}
  ol.next li,ul.next li{position:relative;background:var(--panel);border:1px solid var(--edge);
    border-radius:6px;padding:8px 11px 8px 40px;margin-bottom:6px;}
  .num{position:absolute;left:10px;top:8px;color:var(--accent);font-size:12px;}
  li.done{background:var(--panel);border:1px dashed var(--edge);border-radius:6px;
    padding:8px 11px;margin-bottom:6px;color:var(--muted);text-decoration:line-through;}
  .cols{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;}
  .cols h3{font-size:12px;letter-spacing:2px;color:var(--accent);margin:0 0 8px;}
  footer{max-width:1040px;margin:30px auto 0;padding:14px 16px;color:var(--muted);
    border-top:1px solid var(--edge);font-size:12px;}
  footer b{color:var(--ink);}
  @media(max-width:760px){.cols{grid-template-columns:1fr;}h1{font-size:21px;}}
</style>
</head>
<body>
  <header>
    <div class="gate">⛩ TORII CONTINUUM</div>
    <h1>${escapeHtml(m.title)} <span class="v">${escapeHtml(m.version)}</span></h1>
    <div class="sub">${escapeHtml(m.subtitle)}</div>
    <div class="badge">${escapeHtml(m.badge)}</div>
    <div class="live">Live: ${escapeHtml(m.liveUrl)} · godMode false · build truth (live trails — manual deploy)${m.generatedAt ? ` · packaged: <span id="generated-at">${escapeHtml(m.generatedAt)}</span>` : ''}</div>
  </header>
  <main>
    <section>
      <h2>Active focus</h2>
      <div class="focus">${escapeHtml(m.focus)}</div>
    </section>

    <section>
      <h2>At a glance</h2>
      <div class="grid">
${_metricRows(m.metrics)}
${contrib}
${derivedRow}
      </div>
      <div class="totals">
${_totalsStrip(t)}
      </div>
      <div class="rings">
${_rings(t)}
      </div>
    </section>

    <section>
      <h2>Track overview</h2>
${_trackRows(m.tracks)}
    </section>

    <section>
      <h2>15-hour proof-of-concept route</h2>
      <table>
        <thead><tr><th>#</th><th>Slice</th><th>Status</th></tr></thead>
        <tbody>
${_leanRows(m.leanRoute)}
        </tbody>
      </table>
    </section>

    <section class="cols">
      <div>
        <h3>NOW · Active</h3>
        <ul class="bullets">
${_li(m.activeNow)}
        </ul>
      </div>
      <div>
        <h3>LATER · Archive</h3>
        <ul class="bullets">
${_li(m.archive)}
        </ul>
      </div>
      <div>
        <h3>DONE · Last 24h</h3>
        <ul>
${done24}
        </ul>
      </div>
    </section>

    <section>
      <h2>Next 12 tasks</h2>
      <ol class="next">
${next12}
      </ol>
    </section>

    <section>
      <h2>Risk / blocked / no-blocker</h2>
      <table>
        <thead><tr><th>Item</th><th>State</th><th>Note</th></tr></thead>
        <tbody>
${_riskRows(m.risks)}
        </tbody>
      </table>
    </section>
  </main>
  <footer>
    <b>Source of truth.</b>
    <ul>
${_li(m.sourceOfTruth)}
    </ul>
    Static, read-only oversight surface — generated from packaged project data each deploy; a page refresh shows the latest packaged state. No live writes, signing, relay publishing, or admin actions. Regenerate with <b>npm run build:continuum</b>.
${derivedNote}
  </footer>
  <script>${CONTINUUM_REFRESH_SCRIPT}</script>
</body>
</html>
`;
}
