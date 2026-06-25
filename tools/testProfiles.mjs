// tools/testProfiles.mjs — PURE, node-safe TEST-PROFILE registry (v0.2.173). Defines the
// explicit, deterministic file lists behind the fast / foundation test profiles used for
// quick inner AI/dev loops, plus the validation + formatting helpers. Build/dev tooling
// only — NEVER imported by the game; NO fs/network/THREE/DOM in here (the CLI in
// tools/test-profile.mjs does the fs I/O + spawns vitest and hands plain data to these
// helpers). Deterministic + plain-data so the logic is unit-testable
// (tests/test-profiles.test.js).
//
// Philosophy: agents touching engine seams want a sub-second signal, not the full ~786-test
// suite. The profiles are EXPLICIT curated lists (no git-diff heuristics) so they are stable
// and handoff-friendly. `fast` is the tiny core that breaks first; `foundation` is the wider
// pure-engine + tooling-guard + security-gate core. The FULL suite is still the release gate
// (`npm run test:release`) — profiles speed up iteration, they never replace release safety.

// The glob the full suite (vitest) runs. Profiles are a strict subset of these files.
export const ALL_TESTS_GLOB = 'tests/**/*.test.js';
export const TESTS_DIR = 'tests';

// fast: the smallest core that catches the most regressions when editing engine logic —
// the state machine, the event bus, the headshot classifier/aim math, and the debug
// snapshot. Intended for the innermost edit→test loop (well under a second).
const FAST = [
  'state.test.js',
  'events.test.js',
  'classifier.test.js',
  'aim.test.js',
  'snapshot.test.js',
];

// foundation: fast PLUS the wider pure-engine seams (combat damage, raycast service, player
// boundary, bot agent), the SDK contract surface (sdk barrel, registry, component), the
// read-only security gate, and the build-time guard suites (doc-consistency, handoff-status,
// bundle-sizes, continuum-parse). Broader confidence than fast, still far cheaper than the
// whole suite. Must remain a superset of fast (enforced by validateProfiles + the unit test).
const FOUNDATION = [
  ...FAST,
  'combat-damage.test.js',
  'raycast-service.test.js',
  'player-boundary.test.js',
  'bot-agent.test.js',
  'sdk.test.js',
  'registry.test.js',
  'component.test.js',
  'consent-gate.test.js',
  'gateway-activation.test.js',
  'gateway-portal-activation.test.js',
  'portal-trigger.test.js',
  'zone-route.test.js',
  'portal-mesh-plan.test.js',
  'zone-label.test.js',
  'doc-consistency.test.js',
  'handoff-status.test.js',
  'bundle-sizes.test.js',
  'continuum-parse.test.js',
];

// Frozen registry of basename lists. `release` is intentionally NOT a file list — the
// release gate runs the FULL vitest suite plus check/build/bundle/handoff (see package.json),
// not a curated subset, so it must never be expressed as one here.
export const PROFILES = Object.freeze({
  fast: Object.freeze([...FAST]),
  foundation: Object.freeze([...FOUNDATION]),
});

export const PROFILE_NAMES = Object.freeze(Object.keys(PROFILES));

// isKnownProfile(name) → true iff name is a defined file-list profile. Pure.
export function isKnownProfile(name) {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(PROFILES, name);
}

// profileBasenames(name) → the frozen basename list for a profile, or [] if unknown. Pure.
export function profileBasenames(name) {
  return isKnownProfile(name) ? PROFILES[name] : [];
}

// profileFiles(name) → the profile's test files as `tests/<file>` repo-relative paths
// (the exact args the CLI passes to vitest). Empty for an unknown profile. Pure.
export function profileFiles(name) {
  return profileBasenames(name).map((f) => `${TESTS_DIR}/${f}`);
}

// validateProfiles(existing) → { ok, missing, notSubset, errors }. PURE — `existing` is the
// set/array of test basenames that actually exist on disk (gathered by the caller). Checks:
//   1. every profile file exists in `existing` (no stale entry after a rename/delete), and
//   2. fast ⊆ foundation (the profiles stay nested so a clean `fast` implies a clean subset).
// `ok` is true iff there are zero errors.
export function validateProfiles(existing = []) {
  const have = new Set(existing);
  const missing = [];
  for (const [name, files] of Object.entries(PROFILES)) {
    for (const f of files) {
      const path = `${TESTS_DIR}/${f}`;
      if (!have.has(path)) missing.push({ profile: name, file: path });
    }
  }
  const foundationSet = new Set(PROFILES.foundation);
  const notSubset = PROFILES.fast.filter((f) => !foundationSet.has(f));

  const errors = [];
  for (const m of missing) errors.push(`profile "${m.profile}" lists a missing test: ${m.file}`);
  for (const f of notSubset) errors.push(`fast test not in foundation (profiles must nest): ${f}`);

  return { ok: errors.length === 0, missing, notSubset, errors };
}

// formatProfileLine(name) → a one-line human summary of a profile's size. Pure.
export function formatProfileLine(name) {
  if (!isKnownProfile(name)) return `unknown profile: ${name}`;
  const n = PROFILES[name].length;
  return `profile "${name}": ${n} test file${n === 1 ? '' : 's'}`;
}

// formatTiming(name, fileCount, elapsedMs) → a visible savings/summary footer for logs. Pure.
export function formatTiming(name, fileCount, elapsedMs) {
  const secs = (Math.max(0, Number(elapsedMs) || 0) / 1000).toFixed(2);
  return `test:${name} — ran ${fileCount} file${fileCount === 1 ? '' : 's'} in ${secs}s`;
}
