// tools/playtestChecklist.mjs — PURE, node-safe MVP MANUAL PLAYTEST ACCEPTANCE CHECKLIST
// assembly + formatting. Produces a clear, hand-runnable manual QA / acceptance
// checklist a human (or a future AI handoff) runs against the LIVE build by hand — launch/title,
// the shooter loop, movement/footsteps, aim/hit-feedback/headshots/body-shots, reload feel,
// gun/reflection sanity, mirror sanity, crates/physics-nudge sanity, NAP-monkey sanity, the
// Continuum dashboard, release-metadata/update-prompt, the Nostr read surfaces, and the
// gateway portal/travel-confirm shell — plus the known deferred/non-blocking advisories.
//
// This is NOT a gameplay change and NOT a live browser test: it ASSEMBLES text from a frozen
// curated checklist so a tester has reproduction steps, an expected result, a severity label,
// and a "what to do if it fails" note for every item, with pass/fail/notes fields to fill in.
// Pure + deterministic: NO fs, NO network, NO child_process, NO process, NO browser automation
// in here. The CLI (tools/playtest-checklist.mjs) does the fs/git I/O and stamps the version/
// commit, so the assembly/formatting stays unit-testable (tests/playtest-checklist.test.js).
// Null/garbled inputs degrade to honest defaults; never throws.

// Shared, non-misleading wording for the stamped source commit (this checklist is generated
// before its own commit — see tools/commitStamp.mjs).
import { sourceCommitInline } from './commitStamp.mjs';

// Stable schema id + integer version for the machine-readable (--json) mode. Bump
// PLAYTEST_CHECKLIST_SCHEMA_VERSION on any breaking shape change.
export const PLAYTEST_CHECKLIST_SCHEMA = 'torii.playtest-checklist';
export const PLAYTEST_CHECKLIST_SCHEMA_VERSION = 1;

// Badge naming the artifact as a local, read-only manual checklist — never an automated test
// run, never a deploy/publish action.
export const PLAYTEST_CHECKLIST_BADGE = 'MVP MANUAL PLAYTEST CHECKLIST · LOCAL · READ-ONLY';

// Default in-repo filename for the opt-in --write markdown checklist.
export const PLAYTEST_CHECKLIST_WRITE_FILENAME = 'MVP_PLAYTEST_CHECKLIST.md';

// The title shown atop the checklist.
export const PLAYTEST_CHECKLIST_TITLE = 'Torii Quest — MVP Manual Playtest Acceptance Checklist';

// Severity labels, ordered most-severe first. A 'blocker' failure should stop an MVP-proof
// sign-off; 'major' is a serious-but-not-fatal defect; 'minor' is polish/cosmetic.
export const PLAYTEST_SEVERITIES = Object.freeze(['blocker', 'major', 'minor']);

// The curated checklist. Frozen so a consumer can rely on the order. Each section is
// { key, title, items[] }; each item is { id, title, steps[], expected, severity, ifFailed }.
//   id        a stable short identifier a tester can cite in a bug report
//   steps     ordered reproduction steps (what to DO)
//   expected  the pass condition (what you should SEE)
//   severity  one of PLAYTEST_SEVERITIES — how bad a failure is for MVP sign-off
//   ifFailed  the concrete next action if the item fails
// This is the only narrative the checklist carries; it is hand-maintained as the MVP grows.
export const PLAYTEST_CHECKLIST_SECTIONS = Object.freeze([
  Object.freeze({
    key: 'launch',
    title: 'Launch / title screen',
    items: Object.freeze([
      Object.freeze({
        id: 'LAUNCH-1',
        title: 'Title screen loads and shows the current version',
        steps: Object.freeze([
          'Open the live build URL in a desktop browser.',
          'Wait for the title/landing screen to render.',
        ]),
        expected: 'The title screen appears with the game name and a version label matching the build (the current vX.Y.Z-alpha marker); no console errors block the screen.',
        severity: 'blocker',
        ifFailed: 'Capture the browser console + network tab; check the deployed bundle/version label and re-run the build/deploy. File a blocker.',
      }),
      Object.freeze({
        id: 'LAUNCH-2',
        title: 'Enter / start transitions into the arena',
        steps: Object.freeze([
          'From the title screen, click the start/enter control.',
          'Allow pointer-lock when prompted.',
        ]),
        expected: 'The arena loads, pointer-lock engages, and the first-person view is interactive.',
        severity: 'blocker',
        ifFailed: 'Note whether pointer-lock was blocked by the browser; retry in a focused tab. File a blocker if the arena never loads.',
      }),
    ]),
  }),
  Object.freeze({
    key: 'shooter',
    title: 'Shooter loop',
    items: Object.freeze([
      Object.freeze({
        id: 'SHOOT-1',
        title: 'Core shoot → hit → respawn loop runs',
        steps: Object.freeze([
          'In the arena, locate a bot.',
          'Fire at it until it is defeated; observe the kill-feed.',
          'Wait for the bot to respawn.',
        ]),
        expected: 'Shots register, the bot is defeated, the kill-feed updates, and a bot respawns so the loop continues.',
        severity: 'blocker',
        ifFailed: 'Note whether shots connect at all vs. the bot never dying/respawning; capture console. File a blocker.',
      }),
      Object.freeze({
        id: 'SHOOT-2',
        title: 'ESC pauses instantly and the panel-locked cursor never fires',
        steps: Object.freeze([
          'While in the arena, press ESC.',
          'With the pause/menu panel open, click on the panel and its controls.',
        ]),
        expected: 'ESC pauses immediately (pointer-lock released); clicking the panel interacts with the menu and NEVER fires the weapon.',
        severity: 'blocker',
        ifFailed: 'If a panel click fired the weapon or ESC did not pause, capture steps + console. File a blocker (input-safety regression).',
      }),
    ]),
  }),
  Object.freeze({
    key: 'movement',
    title: 'Movement / footsteps',
    items: Object.freeze([
      Object.freeze({
        id: 'MOVE-1',
        title: 'WASD movement, jump, and arena bounds',
        steps: Object.freeze([
          'Move with WASD across the arena; jump.',
          'Walk into the perimeter walls.',
        ]),
        expected: 'Movement is smooth, jump arcs and lands, and the walls block you (no clipping out of the arena).',
        severity: 'major',
        ifFailed: 'Note where clipping/sticking occurs (coordinates if visible). File a major; escalate to blocker if you can leave the arena.',
      }),
      Object.freeze({
        id: 'MOVE-2',
        title: 'Footstep feedback while moving',
        steps: Object.freeze([
          'Move continuously, then stop.',
        ]),
        expected: 'Footstep feedback plays while moving and stops when you stop; it is not stuck on or silent.',
        severity: 'minor',
        ifFailed: 'Note whether audio is muted/blocked by the browser autoplay policy first. File a minor if footsteps are broken with audio enabled.',
      }),
    ]),
  }),
  Object.freeze({
    key: 'aim',
    title: 'Aim / hit feedback / headshots / body shots',
    items: Object.freeze([
      Object.freeze({
        id: 'AIM-1',
        title: 'Hit feedback distinguishes a connecting shot',
        steps: Object.freeze([
          'Aim at a bot and fire a shot that clearly connects.',
          'Aim at empty space and fire a shot that clearly misses.',
        ]),
        expected: 'A connecting shot shows clear hit feedback; a miss does not. The two are distinguishable.',
        severity: 'major',
        ifFailed: 'Note whether feedback is absent or always-on. File a major (aim feedback is core to the proof).',
      }),
      Object.freeze({
        id: 'AIM-2',
        title: 'Headshots vs. body shots resolve differently',
        steps: Object.freeze([
          'Aim at a bot\'s head/crown and fire.',
          'Aim at a bot\'s torso and fire.',
        ]),
        expected: 'A head hit and a body hit resolve as expected (head registers as the higher-value/lethal hit per the current tuning); aiming at the visible head connects without aiming above the model.',
        severity: 'major',
        ifFailed: 'Note if you must aim above/below the visible head to connect (head-sphere geometry drift). File a major.',
      }),
    ]),
  }),
  Object.freeze({
    key: 'reload',
    title: 'Reload feel',
    items: Object.freeze([
      Object.freeze({
        id: 'RELOAD-1',
        title: 'Reload triggers, feels snappy, and refills ammo',
        steps: Object.freeze([
          'Fire until the magazine is low/empty, or press the reload key.',
          'Observe the reload and the ammo counter.',
        ]),
        expected: 'Reload triggers (manual and/or on-empty), completes in a snappy ~1.1s, and the ammo counter refills to the magazine size.',
        severity: 'minor',
        ifFailed: 'Note the perceived reload duration vs. the tuned value and whether ammo refills. File a minor (feel/tuning).',
      }),
    ]),
  }),
  Object.freeze({
    key: 'gun',
    title: 'Gun / reflection sanity',
    items: Object.freeze([
      Object.freeze({
        id: 'GUN-1',
        title: 'Viewmodel renders correctly and tracks aim',
        steps: Object.freeze([
          'Observe the first-person weapon viewmodel while idle, moving, and firing.',
        ]),
        expected: 'The gun viewmodel renders without obvious gaps/flicker/inverted faces, sits in a sane screen position, and animates with fire/move.',
        severity: 'minor',
        ifFailed: 'Capture a screenshot of the artifact (z-fighting, missing faces, wrong position). File a minor.',
      }),
    ]),
  }),
  Object.freeze({
    key: 'mirror',
    title: 'Mirror sanity',
    items: Object.freeze([
      Object.freeze({
        id: 'MIRROR-1',
        title: 'Mirror reflection is coherent and not a performance sink',
        steps: Object.freeze([
          'Locate the mirror surface and look into it; move in front of it.',
        ]),
        expected: 'The reflection is coherent (no inverted/garbled image, no infinite-recursion meltdown) and does not tank the framerate.',
        severity: 'minor',
        ifFailed: 'Note the visual artifact and any FPS drop. File a minor (cosmetic/perf), escalate if it freezes the page.',
      }),
    ]),
  }),
  Object.freeze({
    key: 'crates',
    title: 'Crates / physics nudge sanity',
    items: Object.freeze([
      Object.freeze({
        id: 'CRATE-1',
        title: 'Crates are solid and behave under a nudge',
        steps: Object.freeze([
          'Walk into the crates; try to walk through them.',
          'Shoot a crate and observe.',
        ]),
        expected: 'Crates are solid (block movement and bullets per the collision model) and do not jitter, launch, or sink through the floor.',
        severity: 'major',
        ifFailed: 'Note clipping vs. physics blow-ups (crate launching/vibrating). File a major if crates are pass-through.',
      }),
    ]),
  }),
  Object.freeze({
    key: 'nap',
    title: 'NAP monkey sanity',
    items: Object.freeze([
      Object.freeze({
        id: 'NAP-1',
        title: 'Crossing the torii gate into the NAP zone disables the weapon',
        steps: Object.freeze([
          'Walk east through the torii gate into the Non-Aggression zone.',
          'Attempt to fire; observe the NAP-zone monkey/bonsai.',
        ]),
        expected: 'East of the gate the weapon is disabled (peace), bots do not cross into the NAP zone, and the NAP-zone props render; walking back west re-enables play.',
        severity: 'major',
        ifFailed: 'Note whether the weapon still fires in the NAP zone or bots cross the gate. File a major (NAP-principle regression).',
      }),
    ]),
  }),
  Object.freeze({
    key: 'continuum',
    title: 'Continuum dashboard',
    items: Object.freeze([
      Object.freeze({
        id: 'CONT-1',
        title: 'Continuum dashboard renders and matches the build version',
        steps: Object.freeze([
          'Open /dashboard.html on the live build.',
        ]),
        expected: 'The dashboard renders version, test status, active slices, and recent work; the version matches the title-screen build and the test counts read as current.',
        severity: 'minor',
        ifFailed: 'Note any stale version/test-count vs. the title screen. File a minor (dashboard data-freshness).',
      }),
    ]),
  }),
  Object.freeze({
    key: 'update',
    title: 'Release metadata / update prompt',
    items: Object.freeze([
      Object.freeze({
        id: 'UPDATE-1',
        title: 'Release metadata is present and the update prompt is read-only',
        steps: Object.freeze([
          'Load /release-metadata.json on the live build.',
          'Trigger/observe any in-app update prompt surface.',
        ]),
        expected: 'release-metadata.json is served and valid (manual-update posture, no auto-update); any update prompt is informational only and performs no automatic download/apply.',
        severity: 'minor',
        ifFailed: 'Note a missing/garbled metadata file or an auto-applying updater. File a major if anything auto-updates; otherwise minor.',
      }),
    ]),
  }),
  Object.freeze({
    key: 'nostr',
    title: 'Nostr read surfaces',
    items: Object.freeze([
      Object.freeze({
        id: 'NOSTR-1',
        title: 'Read-only Nostr surfaces load without signing or publishing',
        steps: Object.freeze([
          'Open the Nostr read/profile/leaderboard surface(s).',
          'Observe loading, and confirm there is no signing/publish action.',
        ]),
        expected: 'Read surfaces populate (or degrade gracefully if a relay is slow) with NO signing prompt and NO publish/write path exposed — read-only proof only.',
        severity: 'minor',
        ifFailed: 'Note whether a relay simply timed out (acceptable, advisory) vs. a signing/publish path appearing (NOT acceptable). File a major if any write/sign path is exposed.',
      }),
    ]),
  }),
  Object.freeze({
    key: 'gateway',
    title: 'Gateway portal / travel confirm shell',
    items: Object.freeze([
      Object.freeze({
        id: 'GATE-1',
        title: 'Gateway portal shows a travel-confirm shell and routes safely',
        steps: Object.freeze([
          'Approach/activate the gateway portal.',
          'Observe the travel-confirm shell; confirm a zone travel.',
          'Try a malformed /zone/<slug> URL directly.',
        ]),
        expected: 'The portal presents a travel-confirm shell (not an instant silent jump); confirming routes to the zone; a malformed slug is rejected/falls back to index rather than breaking the app.',
        severity: 'minor',
        ifFailed: 'Note whether travel happens with no confirm, or a bad slug breaks routing. File a major if a hostile slug escapes the fallback; otherwise minor.',
      }),
    ]),
  }),
]);

// Known deferred / non-blocking advisories a tester should be aware of (do NOT fail sign-off).
export const PLAYTEST_CHECKLIST_ADVISORIES = Object.freeze([
  'The rapier-*.js chunk exceeds the 700 KB bundle advisory (standing, never gated) — expect a one-time load cost.',
  'Nostr read surfaces depend on public relays; a slow/unreachable relay is an advisory, not a failure, as long as the UI degrades gracefully.',
  'Audio (footsteps/feedback) may be blocked until the first user interaction by the browser autoplay policy — interact once before judging audio items.',
  'This is an alpha proof-of-concept: live runtime / Nostr write paths stay gated behind SEC review; there is no signing/publishing to test.',
]);

// How-to-use guidance rendered atop the checklist so a first-time tester knows the protocol.
export const PLAYTEST_CHECKLIST_HOWTO = Object.freeze([
  'Run on a desktop browser against the live build. Fill in Result (PASS / FAIL / N/A) and Notes for each item.',
  'For any FAIL, record the item id, the actual result, and the browser console — then follow the "If it fails" action.',
  'Severity guides sign-off: any open blocker stops the MVP-proof sign-off; majors need a triage decision; minors are polish.',
  'This is a manual checklist — no browser automation is required or implied.',
]);

// _str(x) → trimmed non-empty string, else null. Pure.
function _str(x) {
  return (typeof x === 'string' && x.trim()) ? x.trim() : null;
}

// _obj(x) → a plain object, else null. Pure.
function _obj(x) {
  return (x && typeof x === 'object' && !Array.isArray(x)) ? x : null;
}

// Total number of checklist items across all sections. Pure.
export function playtestItemCount() {
  return PLAYTEST_CHECKLIST_SECTIONS.reduce((n, s) => n + s.items.length, 0);
}

// buildPlaytestChecklistModel(inputs) → a plain, JSON-serialisable checklist model. All inputs
// are plain data the CLI gathers; none are required (the checklist narrative is curated):
//   version      config.js VERSION (a 'vX.Y.Z-alpha' marker); stamped into the header
//   gitCommit    short commit string, or null
//   liveUrl      display URL for the live instance (NOT fetched)
//   generatedAt  OPTIONAL ISO stamp — the ONLY non-deterministic field; omit (null) for
//                reproducible tests; the CLI passes a real stamp at print time.
export function buildPlaytestChecklistModel({
  version = null, gitCommit = null, liveUrl = null, generatedAt = null,
} = {}) {
  return {
    schema: PLAYTEST_CHECKLIST_SCHEMA,
    schemaVersion: PLAYTEST_CHECKLIST_SCHEMA_VERSION,
    generatedAt: _str(generatedAt),
    badge: PLAYTEST_CHECKLIST_BADGE,
    title: PLAYTEST_CHECKLIST_TITLE,
    manual: true,
    version: _str(version),
    gitCommit: _str(gitCommit),
    liveUrl: _str(liveUrl),
    severities: PLAYTEST_SEVERITIES.slice(),
    howTo: PLAYTEST_CHECKLIST_HOWTO.slice(),
    sections: PLAYTEST_CHECKLIST_SECTIONS.map((s) => ({
      key: s.key,
      title: s.title,
      items: s.items.map((it) => ({
        id: it.id,
        title: it.title,
        steps: it.steps.slice(),
        expected: it.expected,
        severity: it.severity,
        ifFailed: it.ifFailed,
      })),
    })),
    itemCount: playtestItemCount(),
    advisories: PLAYTEST_CHECKLIST_ADVISORIES.slice(),
    // Observed safety posture — all false in every run (the checklist only ASSEMBLES text; it
    // runs no automation, navigates nothing, and never serves/deploys/writes/networks).
    safety: {
      automated: false, served: false, navigated: false, deployed: false,
      published: false, wrote: false, network: false,
    },
    rendered: false,
    actionable: false,
  };
}

// formatPlaytestChecklist(model) → a concise multi-line text block for the terminal. Pure; null-safe.
export function formatPlaytestChecklist(model) {
  const m = _obj(model);
  if (!m) return 'playtest-checklist: (no checklist)';
  const L = [];
  L.push(`${m.title}`);
  L.push('─'.repeat(60));
  L.push(`${m.badge}`);
  if (m.generatedAt) L.push(`generated: ${m.generatedAt}`);
  L.push(`version: ${m.version ?? '(unknown)'}${sourceCommitInline(m.gitCommit)}`);
  if (m.liveUrl) L.push(`live: ${m.liveUrl}`);
  L.push(`items: ${m.itemCount} across ${Array.isArray(m.sections) ? m.sections.length : 0} sections  ·  severities: ${(m.severities || []).join(' / ')}`);
  L.push('');
  L.push('How to run:');
  for (const h of (Array.isArray(m.howTo) ? m.howTo : [])) L.push(`  • ${h}`);
  L.push('');
  for (const s of (Array.isArray(m.sections) ? m.sections : [])) {
    L.push(`${s.title}:`);
    for (const it of (Array.isArray(s.items) ? s.items : [])) {
      L.push(`  [ ] ${it.id} (${it.severity}) — ${it.title}`);
      for (const st of (Array.isArray(it.steps) ? it.steps : [])) L.push(`        - ${st}`);
      L.push(`        expect: ${it.expected}`);
      L.push(`        if fail: ${it.ifFailed}`);
      L.push('        result: ____   notes: ____');
    }
    L.push('');
  }
  L.push('Known deferred / non-blocking advisories:');
  for (const a of (Array.isArray(m.advisories) ? m.advisories : [])) L.push(`  • ${a}`);
  L.push('');
  L.push('MANUAL CHECKLIST ONLY — no browser automation, no network, no deploy.');
  L.push('─'.repeat(60));
  return L.join('\n');
}

// formatPlaytestChecklistMarkdown(model) → a markdown checklist suitable for
// MVP_PLAYTEST_CHECKLIST.md, with checkboxes + Result/Notes fields. Pure; null-safe.
export function formatPlaytestChecklistMarkdown(model) {
  const m = _obj(model);
  if (!m) return '# Playtest checklist\n\n_(no checklist)_\n';
  const L = [];
  L.push(`# ${m.title}`);
  L.push('');
  L.push(`> ${m.badge}`);
  if (m.generatedAt) L.push(`> generated: ${m.generatedAt}`);
  L.push('');
  L.push(`- **Version:** ${m.version ?? '(unknown)'}${sourceCommitInline(m.gitCommit)}`);
  if (m.liveUrl) L.push(`- **Live:** ${m.liveUrl}`);
  L.push(`- **Items:** ${m.itemCount} across ${Array.isArray(m.sections) ? m.sections.length : 0} sections`);
  L.push(`- **Severities:** ${(m.severities || []).join(' / ')}`);
  L.push('');
  L.push('## How to run');
  L.push('');
  for (const h of (Array.isArray(m.howTo) ? m.howTo : [])) L.push(`- ${h}`);
  L.push('');
  for (const s of (Array.isArray(m.sections) ? m.sections : [])) {
    L.push(`## ${s.title}`);
    L.push('');
    for (const it of (Array.isArray(s.items) ? s.items : [])) {
      L.push(`### [ ] ${it.id} — ${it.title}  _(${it.severity})_`);
      L.push('');
      L.push('**Steps:**');
      for (const st of (Array.isArray(it.steps) ? it.steps : [])) L.push(`1. ${st}`);
      L.push('');
      L.push(`**Expected:** ${it.expected}`);
      L.push('');
      L.push(`**If it fails:** ${it.ifFailed}`);
      L.push('');
      L.push('| Result (PASS / FAIL / N/A) | Notes |');
      L.push('| --- | --- |');
      L.push('|  |  |');
      L.push('');
    }
  }
  L.push('## Known deferred / non-blocking advisories');
  L.push('');
  for (const a of (Array.isArray(m.advisories) ? m.advisories : [])) L.push(`- ${a}`);
  L.push('');
  L.push('---');
  L.push('');
  L.push('_MANUAL CHECKLIST ONLY — this document runs no browser automation, reaches no ' +
    'network, and triggers no deploy/publish. It is a hand-run acceptance aid for the live ' +
    'build. The parent agent owns security review, deploy, publish, push, and Space upload._');
  L.push('');
  return L.join('\n');
}
