# Torii Quest — Contributor / Agent Handoff

> Single-page onboarding for the next contributor — human or AI agent (Perplexity,
> DeepSeek, perplexica, routstr, or a FOSS human). It captures repo state, the
> hard constraints, where the source of truth lives, and how to build/test/ship.
> It is a working template: keep it current as the codebase moves. It describes
> the project as it is today; it does not promise API/behaviour compatibility
> across versions (this is a pre-1.0 alpha).

---

## 1. What this is

A browser arena shooter: Three.js (WebGL) render layer, Rapier3D (WASM) physics,
Nostr identity, Bitcoin/ecash (fake sats in alpha). Vite 8 build. Pure ES modules.

- **Current version:** v0.2.131-alpha (see §3 for every place the version string lives)
- **Live:** https://torii-quest.pplx.app (a Perplexity Space — deploy is a separate manual step, see §7)
- **License:** GPL-3.0

## 2. Hard constraints (do NOT break these)

These are enforced by `npm run check` (`tools/regression-check.mjs`) and by review.
Breaking one should fail CI/the check, not ship.

1. **Version bump on every deploy.** Every source change that ships bumps the
   version in ALL markers in §3. The check asserts they match `EXPECTED_VERSION`.
2. **`godMode` stays `false`** in `src/config.js`. Never commit `true`.
3. **No new `setTimeout`** except the two existing allowed sites: `nostr.js` (WS
   close) and `hud.js` (kill-feed). The check greps for violators.
4. **No new `Vector3`/`Matrix4` in hot paths.** Reuse module-scope scratch vars.
   The check scans the foundation-module allowlist for `new THREE.(Vector3|Matrix4)`.
   Pure engine modules with NO `three` import are exempt (they can't allocate THREE
   objects) — prefer writing new logic there.
5. **Spelling:** comments say **"nostrich"** (never "ostrich"); the character is
   **"Chiefmonkey"** (exact case).
6. **Debug tools ship unconditionally** (no flag gate) — `window.ToriiDebug` is
   intentional in this public alpha.
7. **ESC = instant pause**; a click that only re-locks a panel-locked cursor must
   never fire the weapon.
8. **Firing rule:** bullets originate at the **gun barrel** and aim **through the
   crosshair** (camera ray finds the aim point; barrel→point is the bullet line).
9. **`state.phase` is written ONLY in `state.js`** (via `transition()`). Other
   modules read predicates (`isPlaying()` etc.), never assign the phase.
10. **No internal use** of the deprecated globals `window._onBotHit`,
    `window._grassMat`, `window._flowerMat`, `window._mirrorMesh` — they remain as
    documented debug taps only; internal code uses the event bus / accessors.
11. **Split by concern, not line count** when extracting modules.
12. Do not name Google, Cloudflare, Microsoft, or Babylon.js in docs.

## 3. Version markers (bump together)

| File | Location |
|---|---|
| `src/config.js` | `export const VERSION` (line ~2) |
| `index.html` | `#version-label` (~407) and `#ver` (~537) |
| `tools/regression-check.mjs` | header comment (line 1), `EXPECTED_VERSION` (~26), stale-version guard regex (~110 — flag the PREVIOUS version) |
| `progress.md` / `todo.md` / `strategy.md` | "Current version" lines |

## 4. Source of truth

- **`src/config.js`** — ALL constants/tuning. Never scatter magic numbers. The
  `TUNING` frozen object mirrors balance values for `ToriiDebug.snapshot().config`.
- **`src/state.js`** — the only place game phase changes; the FSM table + weapon
  predicates (`canShoot`/`canReload`) live here.
- **`src/main.js`** — wiring only, no game logic.
- **`CODE_INDEX.md`** — file-by-file map of the codebase. Update it when you add
  or move a module.
- **`strategy.md`** — vision + decision rules. **`progress.md`** — execution
  dashboard. **`todo.md`** — active task queue.
- **`engine/`** — extracted, mostly-pure SDK seams (debug, physics, combat,
  entities, ui, weapons). Prefer adding pure logic here so it is node-testable.
- **`src/sdk/index.js`** — public SDK entrypoint (ARS-5). Curated node-safe
  re-exports + `SDK_VERSION`, `STABILITY` tiers, and the frozen `SDK_SURFACE`
  tier map. Only re-export modules that never transitively import `scene.js`.

## 5. Build / test / check commands

```bash
npm install
npm run dev      # local dev server (vite)
npm run build    # production build → dist/
npm run check    # static regression guardrails (tools/regression-check.mjs)
npm test         # vitest run (unit tests, node env)
npm run preview  # serve the built dist/ (used for headless smoke)
```

A change is "green" when **build + check + test** all pass. Current baseline:
**163 tests / 15 files**, all 11 regression checks GREEN, build clean.

Tests run in node (`vite.config.js` → `environment: 'node'`). `WebGLRenderer` is
created at module load in `scene.js`, so any module importing `scene.js`
(transitively: `player.js`, `weapons.js`) CANNOT be imported in a node test.
Write new logic as a pure module (no `three`/Rapier/DOM import) to keep it
testable — see `engine/debug/snapshot.js`, `engine/physics/interactions.js`,
`engine/physics/raycastService.js` for the pattern.

Optional headless smoke (not in CI): `npm i -D puppeteer-core`, drive
`/usr/bin/google-chrome-stable` with swiftshader flags against `npm run preview`,
click `#btn-enter`, inspect `window.ToriiDebug.snapshot()`.

## 6. Debug surface

`window.ToriiDebug` (ships in alpha):
- `.snapshot()` — one JSON-serialisable object: version, phase, run state, player
  pos, combat last shot/hit/miss, physics+crate summary, tuning. Safe anytime.
- `.combat.report()` / `.physics.report()` — focused JSON sub-reports.
- `.physics.service` — injectable RaycastService facade (`ray`/`rayStatic`/`lineOfSight`).
- `.bots`, `.player`, `.physics`, `.world`, `.fx`, `.combat`, `.identity`.

## 7. Deploy / publish (MANUAL — not done by task agents)

Deploy target is the **Perplexity Space** at `torii-quest.pplx.app`. The build
artifact is `dist/` (`npm run build`). Publishing/uploading Space files is a
separate manual step performed by the maintainer/main agent — **task agents must
NOT deploy, publish, push, or upload Space files.** Hand back a clean,
green source tree and report the version + changes; the maintainer ships it.

Live currently trails source (see `progress.md` "Deployment" track). Lifting the
source-built artifact to live is its own tracked task (TQ-MANUAL-113 — manual
smoke test on real hardware first).

## 8. Active issues / open edges

- Travel-time lead on fast-moving targets (bullets are hitscan-aimed but
  projectile-flown; long shots on strafing bots can trail). Tracked in `todo.md`.
- Live deployment trails source by several versions — needs manual smoke + publish.
- ARS-5 (`src/sdk/index.js` skeleton) landed in v0.2.131. ARS-4 partial:
  `canShoot`/`canReload` + `isEngaged`/`needsPointerLock` predicates extracted; the
  `reloading` FSM fold and further pointer-lock call-site adoption are still open.
  See `progress.md` Current Sprint.
- ESBUILD-1 (deferred): low-severity dev-server-only esbuild advisory; `npm audit
  fix` pulls a broad rolldown/vite chain, deemed too risky for an alpha — left as a
  tracked WARN in `todo.md`.

## 9. Next-job format

When picking up work, state it as:

```
TASK:        <one line>
VERSION:     bump v0.2.<n> → v0.2.<n+1>-alpha
CONSTRAINTS: (default = all of §2; note any the task explicitly relaxes)
SCOPE:       files expected to change; split by concern
DONE WHEN:   build + check + test green; docs (§4) updated; version markers (§3) bumped
DEPLOY:      NO (maintainer publishes) unless explicitly instructed
```

Keep changes incremental and reversible. If scope balloons, stop at a green
checkpoint and report what remains rather than half-landing a broad rewrite.
