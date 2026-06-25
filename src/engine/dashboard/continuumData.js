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

export const CONTINUUM_VERSION = 'v0.2.181-alpha';
export const CONTINUUM_BADGE = 'PROJECT OVERSIGHT · STATIC · READ-ONLY';

// HEALTH_LASTKNOWN (v0.2.175) — the engineering-health values that are NOT cheaply
// derivable at build time without running the gate (full test count, profile timings,
// bundle baseline, last green release). They are captured by hand from the most recent
// green `npm run test:release` and clearly LABELLED "last-known" on the page, so a stale
// number is obvious rather than silently wrong. The deterministic fields (profile file
// counts, parser gaps, version, doc-sync) are GENERATED at build time and override these.
export const HEALTH_LASTKNOWN = Object.freeze({
  totalTests: '912 passing',
  timings: 'fast ~1s · foundation ~6s · full suite ~41s',
  bundle: '2.9 MB raw / ~1022 KB gzip (rapier chunk >700 KB, expected)',
  regression: '14 / 14',
  lastGreen: CONTINUUM_VERSION,
});

// buildHealthModel(input) — PURE, browser-safe builder for the Engineering-health
// section (v0.2.175). Takes plain data only (no fs/network/THREE/DOM) so it runs both at
// module load (the curated fallback below) AND at build time (tools/build-continuum.mjs
// passes the freshly GENERATED inputs). Each metric carries a `kind`: 'generated' (derived
// deterministically this build) or 'last-known' (captured from the last green gate run),
// surfaced as a chip on the page so provenance is never ambiguous. Returns { note, metrics,
// rings } — a small, dependency-free model the renderer turns into cards + SVG rings.
export function buildHealthModel(input = {}) {
  const {
    version = CONTINUUM_VERSION,
    profiles = {},
    fullFileCount = null,
    parserGaps = null,
    docsInSync = null,
    lastKnown = HEALTH_LASTKNOWN,
  } = input || {};
  const lk = { ...HEALTH_LASTKNOWN, ...(lastKnown || {}) };
  const fast = profiles.fast != null ? profiles.fast : null;
  const foundation = profiles.foundation != null ? profiles.foundation : null;
  const G = 'generated';
  const L = 'last-known';
  const metrics = [
    { label: 'Build version', kind: G, value: version },
    { label: 'Test files / profiles', kind: G,
      value: `fast ${fast == null ? '—' : fast} · foundation ${foundation == null ? '—' : foundation} · full ${fullFileCount == null ? '—' : fullFileCount}` },
    { label: 'Total tests', kind: L, value: lk.totalTests },
    { label: 'Profile timings', kind: L, value: lk.timings },
    { label: 'Bundle baseline', kind: L, value: lk.bundle },
    { label: 'Parser gaps', kind: G,
      value: parserGaps == null ? '—'
        : parserGaps === 0 ? '0 · dashboard lists fully derived'
        : `${parserGaps} · curated fallback used` },
    { label: 'Release gate', kind: L, value: `${lk.regression} regression checks GREEN · last green ${lk.lastGreen}` },
    { label: 'Source-of-truth docs', kind: G,
      value: docsInSync == null ? 'progress.md · todo.md · strategy.md'
        : docsInSync ? 'progress.md · todo.md · strategy.md carry this version'
        : 'doc/version drift — check the continuity docs' },
  ];
  const coverage = (foundation != null && fullFileCount)
    ? Math.round((foundation / fullFileCount) * 100) : null;
  const rings = [
    { pct: 100, label: 'Tests passing', sub: 'last green' },
    { pct: 100, label: 'Regression checks', sub: lk.regression },
    { pct: coverage, label: 'Foundation coverage',
      sub: (foundation != null && fullFileCount) ? `${foundation}/${fullFileCount} files` : 'profiles' },
  ];
  const note = 'Engineering health — the efficiency/oversight loop: measure · profile · ' +
    'standardise · automate · modularise · document. GENERATED at build time where ' +
    'deterministic (profile sizes, parser gaps, version, doc-sync); LAST-KNOWN where ' +
    'captured from the most recent green release-gate run (total tests, timings, bundle).';
  return { note, metrics, rings };
}

// The curated fallback health model — built from the pure builder at module load with the
// current known counts, so renderContinuumPage() with NO overrides (tests + the no-JS
// fallback) shows a complete, honest Engineering-health section. The build-time generator
// re-runs buildHealthModel with freshly measured inputs and overrides this.
const CURATED_HEALTH = buildHealthModel({
  version: CONTINUUM_VERSION,
  profiles: { fast: 5, foundation: 17 },
  fullFileCount: 60,
  parserGaps: 0,
  docsInSync: true,
});

// SEED_MILESTONES (v0.2.176) — clearly-labelled FUTURE milestones. These are NOT real,
// tracked task sets; they are a seed roadmap so the dashboard can show "total milestones"
// HONESTLY (one real ACTIVE milestone + N SEED/future) without pretending the future ones
// have real task counts. Future parser hook: derive these from strategy.md. Pure data.
export const SEED_MILESTONES = Object.freeze([
  { id: 'M-RELAY', name: 'Live relay I/O + event signing',
    note: 'Gated by SEC-1/2/3 — explicit consent, handoff verification, and URL validation must clear before any wire write or live navigation.' },
  { id: 'M-WORLD', name: 'Open-world NAP-to-NAP federation',
    note: 'Real in-world portals plus a formalised NAP zone registry, beyond the inert travel preview.' },
  { id: 'M-MARKET', name: 'Component / Plebeian market economy',
    note: 'A CMP component marketplace and real Plebeian.Market listings over the read-only product-panel shells.' },
]);

// buildMilestoneModel(input) — PURE, browser-safe (v0.2.176). Folds the 15-hour MVP route
// (the ONE true active milestone — its leanRoute slices ARE its tasks) into task counts +
// a directional % complete, and lists the clearly-labelled SEED future milestones so a
// "total milestones" figure is honest (1 active + N seed). No fs/network/THREE/DOM. Returns
// a small model the renderer turns into a progress card + seed cards. `tasks.done/active/
// pending` are DERIVED from each slice's `state`; `donePct` is done/total; `progressPct` is
// the directional mean of the per-slice `progress` estimates (the same number as the PoC
// ring), labelled as an estimate on the page so it is never mistaken for tasks-done.
export function buildMilestoneModel(input = {}) {
  const {
    leanRoute = CONTINUUM.leanRoute,
    seed = SEED_MILESTONES,
    name = '15-hour proof-of-concept route',
    blurb = 'The one true ACTIVE milestone — the freedom-tech loop: gateway/NAP-to-NAP ' +
      'travel → Plebeian/Nostr product panel → leaderboard → torii.quest update-check.',
  } = input || {};
  const tasks = Array.isArray(leanRoute) ? leanRoute : [];
  const total = tasks.length;
  const done = tasks.filter((t) => t.state === 'done').length;
  const active = tasks.filter((t) => t.state === 'in-progress').length;
  const pending = tasks.filter((t) => t.state === 'pending').length;
  const donePct = total ? Math.round((done / total) * 100) : 0;
  const progressPct = _average(tasks.map((t) => clampPct(t.progress) || 0));
  const activeMilestone = {
    id: 'MVP-15H', kind: 'active', name, blurb,
    tasks: { total, done, active, pending },
    donePct, progressPct,
    // Bullet-ready breakdown (user preference: bullet lists, not comma-separated prose).
    counts: [
      `${total} tasks total`,
      `${done} done`,
      `${active} active`,
      `${pending} pending`,
    ],
  };
  const seedList = (Array.isArray(seed) ? seed : []).map((s) => ({ ...s, kind: 'seed' }));
  return {
    active: activeMilestone,
    seed: seedList,
    counts: { total: 1 + seedList.length, active: 1, seed: seedList.length, done: 0 },
    note: 'One real ACTIVE milestone (its tasks are the 15-hour MVP slices, DERIVED from ' +
      'the route states); the rest are SEED/future milestones — labelled as such, not ' +
      'pretending to carry real task counts yet. Future hook: derive seed milestones from strategy.md.',
  };
}

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
    { label: 'Source version', value: 'v0.2.181-alpha (build truth; live trails — manual deploy)' },
    { label: 'Tests', value: '912 passing / 63 files (profiles: test:fast ~5, test:foundation ~20)' },
    { label: 'Regression check', value: '14 / 14 GREEN' },
    { label: 'Bundle (advisory)', value: '~2.9 MB raw / ~1022 KB gzip (rapier chunk >700 KB, expected)' },
    { label: 'Gates', value: 'SEC-1 / SEC-2 / SEC-3 intact · godMode false · continuum CSP enforced' },
    { label: 'Active slice', value: 'v0.2.181 LEAN-2 in-world gateway PORTAL TRIGGER — proximity tick arms the injected portal boundary + raises a prompt (both inert); an explicit KeyF interact is the ONLY navigating step (confirmed same-origin /zone hop). Window injected only at the main.js boundary; allowlist scoped [/zone/] (never [/])' },
  ],

  // Engineering-health model (v0.2.175) — the efficiency/oversight loop surfaced on the
  // page as cards + rings. Curated fallback; the build-time generator overrides the
  // GENERATED fields (profile counts, parser gaps, version, doc-sync) with measured values.
  health: CURATED_HEALTH,

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
    { id: 'LEAN-2', state: 'in-progress', progress: 70, slice: 'Gateway / NAP-to-NAP travel', status: 'in-world PORTAL TRIGGER now wired (181): proximity arms the injected boundary + prompt (inert); an explicit KeyF interact performs the confirmed same-origin hop over the real window injected at the main.js boundary; needs a dedicated portal MESH + SPA route handler for a full 3D landing' },
    { id: 'LEAN-3', state: 'in-progress', progress: 45, slice: 'Plebeian/Nostr product panel', status: 'shells + visible preview; needs in-world mesh + real listing' },
    { id: 'LEAN-4', state: 'in-progress', progress: 40, slice: 'Leaderboard (Nostr signed events)', status: 'unsigned helpers + publisher adapter + view + relay-read proof; needs real signer (SEC-1) + relay read' },
    { id: 'LEAN-5', state: 'in-progress', progress: 55, slice: 'torii.quest GitHub update-check', status: 'helper + view-model + release source/status; needs read-only releases fetch + prompt mesh' },
  ],

  // Now / Next / Later.
  activeNow: [
    'v0.2.181 — LEAN-2 in-world gateway PORTAL TRIGGER (portalTrigger.js) wired at the main.js boundary: a pure per-frame tick(playerPos) uses withinPortalRange (scalar, no Vector3) to ARM the v0.2.180 portal boundary + raise a HUD prompt when the player nears the torii gate — both INERT (no navigation). An explicit KeyF interact() is the ONLY navigating step: it confirms and performs the same-origin /zone hop over the REAL browser window, which is injected ONCE at the composition root and nowhere at module scope. Allowlist stays scoped [\'/zone/\'] (never [\'/\']); external website URLs are never navigated. SDK + debug-shell (recording host) exposure. +18 tests.',
    'ARS-4 — finish folding reload/pointer-lock into the guarded FSM.',
    'ARS-6 / PROGRESS-1 — ongoing CODE_INDEX + living-docs upkeep.',
  ],

  next12: [
    'Drive gatewayActivation (v0.2.178) from a real host router: inject the app/browser window or host transport at the gateway boundary + a same-origin route allowlist wired to CSP, so a confirmed in-world hop performs the live same-origin navigation.',
    'Gateway portal mesh — actually move the player in-world on a confirmed hop (front-end trigger for the live-wired activation seam).',
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
    'v0.2.181 — LEAN-2 in-world gateway PORTAL TRIGGER (portalTrigger.js) wired at the main.js composition root: a pure per-frame tick(playerPos) uses withinPortalRange (scalar squared-distance, NO Vector3) to ARM the v0.2.180 portal boundary + raise a HUD prompt when the player nears the torii gate — both INERT. Proximity ALONE never navigates; an explicit KeyF interact() is the ONLY navigating step, confirming the same-origin /zone hop over the REAL browser window injected ONCE at the boundary (no module-scope window). Allowlist stays scoped [\'/zone/\'] (never [\'/\']); external website URLs never navigate; external/world/network/sign/publish stay false; SEC-2 untouched. SDK (experimental) + debug-shell (recording host) exposure. +18 tests.',
    'v0.2.180 — LEAN-2 in-world gateway PORTAL ACTIVATION seam (gatewayPortalActivation.js): bridges a gateway COMPONENT to the v0.2.178 confirmed same-origin hop. portalActivationInput() maps a gateway\'s internal target → a /zone/<slug> activation input (external website DROPPED — same-origin route only); sanitizePortalAllowlist() folds a trivially-permissive [\'/\'] to the scoped default [\'/zone/\'] (never permit-all); createGatewayPortalBoundary() is an injected-transport ARM → CONFIRM controller (arming is INERT; only confirm() resolves the transport + acts); withinPortalRange() is a scalar (no Vector3) proximity helper. No module-scope window; no external nav/world-reload/network/sign/publish; SEC-2 untouched. SDK (experimental) + debug-shell (recording host) exposure. +28 tests.',
    'v0.2.179 — LEAN-2 gateway ROUTE HARDENING (security-review follow-up before any live gateway wiring): safeRoutePath now also rejects any dot-dot (..) traversal segment and any percent (%) encoding — closing /zone/../admin + /zone/%2e%2e/admin climb-out attempts (internally-built /zone/<slug> routes never need either) — and _routeAllowed ignores allowlist prefixes shorter than 2 chars so a [\'/\'] allowlist fails CLOSED (matches nothing) rather than allowing every same-origin route; meaningful prefixes such as [\'/zone/\'] still allow /zone/foo. Pure/node-safe, never navigates. +5 tests.',
    'v0.2.178 — LEAN-2 gateway handoff ACTIVATION (gatewayActivation.js): live-wired the confirmed same-origin host transport into the v0.2.168 executor. resolveHostTransport() picks an injected transport / a browser History-pushState transport from a window / a recording host; activateGatewayHandoff() double-gates on a literal confirmed:true AND the consent-gated dry-run plan AND an optional same-origin route allowlist before resolving any transport — so preview/render/unconfirmed paths can never navigate. Rollback/back-home reachable; external/world/sign/publish/network all stay false. SDK (experimental tier) + debug-shell (in-memory recording host) exposure. +tests.',
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
    milestones: base.milestones || buildMilestoneModel({ leanRoute: base.leanRoute }),
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
    health: model.health || null,
    milestones: model.milestones || null,
  };
}

// ---- HTML render fragments -------------------------------------------------

const _li = (items) => items.map((x) => `        <li>${escapeHtml(x)}</li>`).join('\n');

// _cardValueHtml(value) — render a metric/health card value (v0.2.176). User preference:
// grouped data should be a BULLET LIST, not one dense comma/dot-separated line. A value
// joined with ' · ' of 2+ parts becomes a compact <ul class="mini"> bullet list; a single
// part stays a plain value span. Each part is HTML-escaped; the <ul>/<li>/<span> markup is
// our own static markup. No new script; the CSP/refresh-script hash is untouched. Pure.
// _h2(title, count) — a section heading row (v0.2.177): the heading plus an optional
// item-count chip so each section is scannable at a glance. Server-rendered + escaped.
function _h2(title, count) {
  const chip = count != null ? ` <span class="count">${escapeHtml(count)}</span>` : '';
  return `<div class="h2row"><h2>${escapeHtml(title)}</h2>${chip}</div>`;
}

function _cardValueHtml(value) {
  const raw = String(value == null ? '' : value);
  const parts = raw.split(' · ').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return `<ul class="mini">${parts.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`;
  }
  return `<span class="metric-value">${escapeHtml(raw)}</span>`;
}

function _metricRows(metrics) {
  return metrics.map((m) =>
    `        <div class="metric"><span class="metric-label">${escapeHtml(m.label)}</span>${_cardValueHtml(m.value)}</div>`
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

// _healthChip(kind) — provenance chip markup (our own static markup, not escaped). Only
// the two known kinds emit a chip; anything else renders bare. Pure.
function _healthChip(kind) {
  if (kind === 'generated') return '<span class="hk hk-gen">GENERATED</span>';
  if (kind === 'last-known') return '<span class="hk hk-lk">LAST-KNOWN</span>';
  return '';
}

function _healthCards(metrics) {
  return metrics.map((mtc) =>
    `        <div class="metric"><span class="metric-label">${escapeHtml(mtc.label)} ${_healthChip(mtc.kind)}</span>${_cardValueHtml(mtc.value)}</div>`
  ).join('\n');
}

// _milestoneCard(ms) — the ACTIVE milestone progress card (v0.2.176): name + ACTIVE pill,
// blurb, a directional %-complete progress bar with a "tasks done" sub, and a bullet list
// of the DERIVED task-state counts (total/done/active/pending). Server-rendered + escaped.
function _milestoneCard(ms) {
  const pct = clampPct(ms.progressPct) || 0;
  const counts = (ms.counts || []).map((c) => `          <li>${escapeHtml(c)}</li>`).join('\n');
  return `      <div class="ms ms-active">
        <div class="ms-head"><span class="ms-name">${escapeHtml(ms.name)}</span><span class="pill ms-pill-active">ACTIVE</span></div>
        <div class="ms-blurb">${escapeHtml(ms.blurb)}</div>
        <div class="ms-meta"><span class="ms-pct">${pct}% complete <span class="ms-sub">(directional estimate)</span></span><span class="ms-sub">${escapeHtml(ms.tasks.done)} / ${escapeHtml(ms.tasks.total)} tasks done</span></div>
        <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
        <ul class="mini ms-counts">
${counts}
        </ul>
      </div>`;
}

// _seedMilestoneCards(seed) — the SEED/future milestones, each with a clear SEED chip so
// they are never mistaken for real tracked task sets. Server-rendered + escaped.
function _seedMilestoneCards(seed) {
  return (seed || []).map((s) =>
    `      <div class="ms ms-seed">
        <div class="ms-head"><span class="ms-name">${escapeHtml(s.name)}</span><span class="seed">SEED · future</span></div>
        <div class="ms-blurb">${escapeHtml(s.note)}</div>
      </div>`
  ).join('\n');
}

// _milestonesSection(ms) — the Milestones section (v0.2.176): an honest total
// (1 active + N seed), the active milestone progress card, the seed/future cards, and a
// provenance note. Empty string when absent so a legacy model omits the section. Pure.
function _milestonesSection(ms) {
  if (!ms || !ms.active) return '';
  const c = ms.counts || {};
  const note = ms.note ? `      <div class="focus">${escapeHtml(ms.note)}</div>` : '';
  return `
    <section>
      ${_h2('Milestones', c.total)}
      <div class="lead">The one true ACTIVE milestone vs. clearly-labelled SEED/future roadmap.</div>
      <div class="ms-totals">Total milestones: <b>${escapeHtml(c.total)}</b> — <b>${escapeHtml(c.active)}</b> active, <b>${escapeHtml(c.seed)}</b> seed/future <span class="seed">SEED · not yet tracked</span></div>
${_milestoneCard(ms.active)}
      <div class="ms-grid">
${_seedMilestoneCards(ms.seed)}
      </div>
${note}
    </section>`;
}

// _healthSection(health) — the Engineering-health section (v0.2.175): provenance-chipped
// metric cards + reused SVG rings + the efficiency-loop note. Empty string when absent, so
// an override-free legacy model simply omits the section. Server-rendered + escaped; no
// new script, no new data-k key → CSP/refresh-script hash untouched.
function _healthSection(health) {
  if (!health || !Array.isArray(health.metrics) || !health.metrics.length) return '';
  const rings = Array.isArray(health.rings) && health.rings.length
    ? `      <div class="rings">\n${health.rings.map((r) => _donut(r.pct, r.label, r.sub)).join('\n')}\n      </div>`
    : '';
  const note = health.note ? `      <div class="focus">${escapeHtml(health.note)}</div>` : '';
  return `
    <section>
      ${_h2('Engineering health', health.metrics.length)}
      <div class="lead">The efficiency loop in numbers — each card chipped GENERATED or LAST-KNOWN.</div>
      <div class="grid">
${_healthCards(health.metrics)}
      </div>
${rings}
${note}
    </section>`;
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
    ? `        <div class="metric"><span class="metric-label">Docs-derived <span class="seed">DERIVED · build-time</span></span>${_cardValueHtml(
        [
          tt.todoCompletedMarkers != null ? `${tt.todoCompletedMarkers} completed task markers (todo.md)` : null,
          t.tasksAhead != null ? `${t.tasksAhead} next-12` : null,
          t.archivedClusters != null ? `${t.archivedClusters} archive clusters` : null,
        ].filter(Boolean).join(' · ')
      )}</div>`
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
  main{max-width:1080px;margin:0 auto;padding:0 16px;}
  section{margin-top:34px;}
  .h2row{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin:0 0 4px;}
  h2{font-size:13px;letter-spacing:3px;color:var(--gold);text-transform:uppercase;
    border-left:3px solid var(--hot);padding-left:10px;margin:0;}
  .count{color:var(--accent);font-size:11px;letter-spacing:1px;
    border:1px solid var(--edge);border-radius:10px;padding:0 8px;}
  .lead{color:var(--muted);font-size:12px;letter-spacing:.4px;margin:0 0 12px;padding-left:13px;}
  .focus{background:var(--panel);border:1px solid var(--edge);border-radius:6px;
    padding:12px 14px;color:var(--muted);margin-top:14px;}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;}
  .metric{background:var(--panel);border:1px solid var(--edge);border-radius:6px;
    padding:10px 12px;display:flex;flex-direction:column;gap:3px;transition:border-color .15s;}
  .metric:hover,.ms:hover,.track:hover,.tot:hover{border-color:var(--accent);}
  .metric-label{color:var(--muted);font-size:11px;letter-spacing:1px;text-transform:uppercase;}
  .metric-value{color:var(--ink);}
  .seed{color:var(--gold);font-size:9px;border:1px solid var(--gold);border-radius:4px;padding:0 4px;letter-spacing:1px;}
  .hk{font-size:9px;border:1px solid;border-radius:4px;padding:0 4px;letter-spacing:1px;}
  .hk-gen{color:var(--accent);border-color:var(--accent);}
  .hk-lk{color:var(--muted);border-color:var(--muted);}
  ul.mini{list-style:none;margin:2px 0 0;padding:0;}
  ul.mini li{position:relative;padding:1px 0 1px 14px;color:var(--ink);font-size:13px;}
  ul.mini li::before{content:"▹";position:absolute;left:0;color:var(--accent);}
  .ms{background:var(--panel);border:1px solid var(--edge);border-radius:6px;padding:12px 14px;margin-bottom:10px;}
  .ms-active{border-left:3px solid var(--accent);}
  .ms-seed{border-left:3px solid var(--gold);opacity:.92;}
  .ms-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;}
  .ms-name{letter-spacing:1px;color:var(--ink);}
  .ms-pill-active{color:var(--accent);border-color:var(--accent);}
  .ms-blurb{color:var(--muted);font-size:12px;margin:6px 0 8px;}
  .ms-meta{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:12px;}
  .ms-pct{color:var(--accent);}
  .ms-sub{color:var(--muted);font-size:11px;}
  .ms-counts{margin-top:8px;}
  .ms-totals{color:var(--muted);margin-bottom:12px;}
  .ms-totals b{color:var(--ink);}
  .ms-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;}
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
  .cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;align-items:start;}
  .cols h3{font-size:12px;letter-spacing:2px;color:var(--accent);margin:0 0 8px;
    display:flex;align-items:baseline;gap:8px;}
  .cols h3 .count{color:var(--muted);}
  footer{max-width:1080px;margin:38px auto 0;padding:14px 16px;color:var(--muted);
    border-top:1px solid var(--edge);font-size:12px;}
  footer b{color:var(--ink);}
  @media(max-width:760px){h1{font-size:21px;}}
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
      ${_h2('Active focus')}
      <div class="lead">What the project is pointed at right now — read this first.</div>
      <div class="focus">${escapeHtml(m.focus)}</div>
    </section>
${_milestonesSection(m.milestones)}

    <section>
      ${_h2('At a glance', m.metrics.length)}
      <div class="lead">Build truth: source version, test/gate status, and the headline progress rings.</div>
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
${_healthSection(m.health)}

    <section>
      ${_h2('Track overview', m.tracks.length)}
      <div class="lead">Directional per-track completion — momentum, not archaeology.</div>
${_trackRows(m.tracks)}
    </section>

    <section>
      ${_h2('15-hour proof-of-concept route', m.leanRoute.length)}
      <div class="lead">The active milestone's slices (LEAN-1..5) and what each still needs to ACT.</div>
      <table>
        <thead><tr><th>#</th><th>Slice</th><th>Status</th></tr></thead>
        <tbody>
${_leanRows(m.leanRoute)}
        </tbody>
      </table>
    </section>

    <section>
      ${_h2('Now · Next · Later')}
      <div class="lead">Active work, the archive of landed clusters, and what shipped in the last day.</div>
      <div class="cols">
        <div>
          <h3>NOW · Active <span class="count">${m.activeNow.length}</span></h3>
          <ul class="bullets">
${_li(m.activeNow)}
          </ul>
        </div>
        <div>
          <h3>LATER · Archive <span class="count">${m.archive.length}</span></h3>
          <ul class="bullets">
${_li(m.archive)}
          </ul>
        </div>
        <div>
          <h3>DONE · Last 24h <span class="count">${m.completed24h.length}</span></h3>
          <ul>
${done24}
          </ul>
        </div>
      </div>
    </section>

    <section>
      ${_h2('Next 12 tasks', m.next12.length)}
      <div class="lead">The ordered queue — top of the list is the next thing to pick up.</div>
      <ol class="next">
${next12}
      </ol>
    </section>

    <section>
      ${_h2('Risk / blocked / no-blocker', m.risks.length)}
      <div class="lead">What can move freely vs. what is gated, manual, or a tracked open edge.</div>
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
