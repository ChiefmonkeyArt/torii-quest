# Torii Quest — Contributor / Agent Handoff

Single-page onboarding for the next contributor — human or AI agent. Keep it current as the codebase moves. Pre-1.0 alpha; no API/behaviour compatibility promise across versions.

**Current version:** v0.2.370-alpha (source at v0.2.370-alpha; LIVE at v0.2.366-alpha on https://chiefmonkey.art/quest/ — Torii Suite SHC VPS install; pplx.app backend sandbox still 503, kept as secondary. See §9 + “Deployment conventions” in torii-quest-todo.md)

---

## 1. What this is

A browser arena shooter — Three.js (WebGL) render, Rapier3D (WASM) physics, Nostr identity, Bitcoin/ecash (fake sats in alpha). Vite build. Pure ES modules. GPL-3.0.

- **Live:** https://chiefmonkey.art/quest/ (SHC VPS, Torii Suite install — primary). Secondary (broken backend): https://quest-torii.pplx.app. Publish to pplx.app is a separate manual step — see §7.
- **Active focus:** 15-hour proof-of-concept route (`torii-quest-strategy.md` → "15-Hour Proof-of-Concept Route"; `torii-quest-todo.md` → "ACTIVE FOCUS"). Shooter is maintenance-only; the active MVP is the freedom-tech loop — gateway/NAP-to-NAP preview, Plebeian/Nostr product panel proof, leaderboard preview, torii.quest update-check (LEAN-1..LEAN-5).
- **MP-3 (v0.2.366-alpha) LANDED to main, awaiting publish.** Nostr score/leaderboard, client-signed via nip07 (window.nostr). Server broadcasts authoritative `SCORE` frame on peer disconnect; each peer signs OWN row and publishes to configured relays as **kind:30078 (`d=torii-quest`, NIP-33 parameterized replaceable current entry)** + **kind:1 (`t=torii-quest-score`, durable history for lifetime aggregation)**. LocalStorage dedupe key `tq.mp3.published:{sessionId}:{endedAt}`. Empty-row guard skips 0-kills/0-deaths/0-damage rows (still dedupe-marked). Session id is 16-hex from server `randomBytes(8)`, regex `/^[0-9a-f]{16}$/`. Additive on `PROTOCOL_VERSION=1` (server→client only). Dashboard tile added: `buildLeaderboardModel` renders top-5 via `renderDashboardTile`. 4 new src modules: `server/combat/scoreLedger.js`, `src/engine/multiplayer/scoreReporter.js`, `src/engine/multiplayer/leaderboardAgg.js`, `src/ui/leaderboardPanel.js`. ~53 new tests (score-ledger, wire, reporter, agg, panel, integration, dashboard). Regression checks 19 (SCORE additive on `PROTOCOL_VERSION=1`) + 20 (leaderboard constants lock: `SCORE_KIND_ADDRESSABLE=30078`, `SCORE_KIND_HISTORY=1`, `SCORE_D_TAG='torii-quest'`, `SCORE_HISTORY_T_TAG='torii-quest-score'`). Green gate: 2264/2264 tests, 20/20 checks, release:status READY. PR #23 squash-merged into main at commit `f8f7499`. `dist/package.json` written with `ws@^8.21.0` runtime dep. Pre-publish security review PASS across all checks. **Publish blocked** by pplx-tool bridge outage — every `pplx-tool` call returns `503 "tool bridge is not connected"` (describe ×3 + actual `deploy_website`). Diagnostic `9a174646-325a-4e00-a21b-f71fcb8dc4c1` (supersedes prior `07c84677-0e5d-4800-a18b-05282d8d51f3`). Down ~32h+ since ~00:30 BST July 10. **Confirmed 2026-07-11: NOT a per-session stuck worker** — a fresh Computer session still gets 503; it's a platform-side outage. Maintainer to file Perplexity support; do not burn credits retrying.

**QA-MP-BLOCKER-1 root cause found 2026-07-11 (Computer session):** the visibility bug is **not** H1–H4. The published site's **backend sandbox is down** (frontend `GET /` → 200 at v0.2.366-alpha; backend `GET /port/5000/` → 503 then 12s timeout). WS upgrade OPENs at the proxy but no HELLO arrives — dead backend behind live proxy. Server code is healthy: `node dist/server/arena-ws.cjs` boots locally and sends `HELLO` (`serverVersion: v0.2.366-alpha`) in 9ms. **H1 eliminated** — live `arenaRuntime-DsJt_cka.js` chunk has the `__PORT_5000__` sentinel correctly rewritten to `port/5000` (0× literal, 1× `port/5000`); the S3-upload rewrite DOES reach code-split chunks. Fix = republish once the bridge recovers. Full detail in `torii-quest-todo.md` §QA-MP-BLOCKER-1 STATUS UPDATE. **Trigger to publish once bridge recovers:** `deploy_website(project_path=/home/user/workspace/torii-quest/dist, site_name='Torii Quest', entry_point='index.html')` then `publish_website(project_path=/home/user/workspace/torii-quest/dist, dist_path=/home/user/workspace/torii-quest/dist, app_name='Torii Quest', site_id='93507979-679f-4aac-949d-20a4a33d7352', port=5000, run_command='node server/arena-ws.cjs', install_command='npm install --omit=dev --no-audit --no-fund')`.
- **MP-1.5 (arena-ws in pplx.app sandbox) LANDED v0.2.365-alpha.** Node backend runs INSIDE the pplx.app publish sandbox — `arena-ws.js` bundled via esbuild to `dist/server/arena-ws.cjs`, binds `0.0.0.0:$PORT`, HTTP+WSS via `on('upgrade')`, client uses `__PORT_5000__` sentinel (rewritten to `port/5000` at S3 upload). Live handshake verified at `wss://quest-torii.pplx.app/port/5000/mp` returning HELLO with `serverVersion: v0.2.365-alpha`. Sovereign Hybrid Compute VPS is currently paused / not connected — pplx.app sandbox is the ONLY multiplayer host for now.
- **Multiplayer:** MP-2 LANDED v0.2.364-alpha — server-authoritative hit resolution on the same wire (`PROTOCOL_VERSION=1`, additive `RESPAWN` only). Pure server modules under `server/combat/` (snapshotRing, capsuleModel, rayVsCapsule, damageTable, hpLedger, hitResolver); arena-ws wiring keeps a per-peer ring, rewinds to shot ts (clamped to `LAG_COMP_MS=300`), damages via a parity-locked table (head=9, body=3), broadcasts `HIT`/`KILL` to ALL, and issues `RESPAWN` to the victim after `RESPAWN_MS=3000`. Client `sendHit` is a no-op; `wsClient` handles `RESPAWN` and `arenaRuntime` warps the player + resets HP. One-flag rollback via `MP_MODE=advisory` in the systemd unit restores MP-1 relay semantics with no redeploy (VPS_INSTALL.md §16.6). MP-1 LANDED v0.2.363-alpha (advisory hit detection) remains reachable via that fallback. Same behaviour gate (`MP_ENABLED = false`; single `if(MP_ENABLED)` seam in `arenaRuntime.js`). Single-origin `wss://<domain>/mp` via Caddy reverse-proxy — no subdomains (VPS_INSTALL.md §16). Turn on via Instance Settings → Multiplayer once the operator has installed the `/mp` block + `torii-arena-ws` systemd unit.

## 2. Standing operating rules (project-wide, across all Torii repos)

1. Each Torii app lives in a fully separate GitHub repo (`torii-quest`, `torii-continuum`, `torii-de`, `torii-base`, `torii-suite`). Files carry ONLY that repo's project name — Quest files say "quest", never "continuum" or "de". Never cross-name.
2. Bump the version on EVERY change — including doc-only changes, comment tweaks, filename renames, typo fixes.
3. Push everything to GitHub immediately via a PR that lands on `main`. No local-only work.
4. Never publish device names, hostnames, or local machine identifiers to GitHub. Use generic terms like "your local machine".

## 3. Hard constraints (do NOT break these)

Enforced by `npm run check` (`tools/regression-check.mjs`).

1. **Version bump on every deploy.** Every marker in §4 matches `EXPECTED_VERSION`.
2. **`godMode` stays `false`** in `src/config.js`. Never commit `true`.
3. **No new `setTimeout`** except the two allowed sites (`nostr.js` WS-close, `hud.js` kill-feed).
4. **No new `Vector3`/`Matrix4` in hot paths.** Reuse module-scope scratch vars. Modules with no `three` import are exempt.
5. **Spelling:** comments say "nostrich" (never "ostrich"); character is "Chiefmonkey" (exact case).
6. **Debug tools ship unconditionally** — `window.ToriiDebug` is intentional in public alpha.
7. **ESC = instant pause**; a click that only re-locks a panel-locked cursor must never fire the weapon.
8. **Firing:** bullets originate at the gun barrel and aim through the crosshair (camera ray finds aim point; barrel→point is the bullet line).
9. **`state.phase` is written ONLY in `state.js`** (via `transition()`). Others read predicates (`isPlaying()` etc.).
10. **No internal use** of deprecated globals `window._onBotHit`, `window._grassMat`, `window._flowerMat`, `window._mirrorMesh` — kept as documented debug taps only.
11. **Split modules by concern, not line count.**
12. **Do not name** Google, Cloudflare, Microsoft, or Babylon.js in docs.

## 4. Version markers (bump together)

| File | Location |
|---|---|
| `src/config.js` | `export const VERSION` |
| `index.html` | `#version-label`, `#ver` |
| `package.json` | `"version"` — semver form, no leading `v` |
| `tools/regression-check.mjs` | header comment, `EXPECTED_VERSION`, stale-version guard regex (flag the PREVIOUS version) |
| `src/engine/dashboard/toriiQuestData.js` | `TORII_QUEST_VERSION` (pinned to `config.js`) + `metrics` "Source version" + "Tests" test-count row |
| `public/sw.js` | `CACHE_VERSION` literal (`tq-<version>`) — copied verbatim by Vite; check [5] fails if stale |
| `MVP_APPROVAL_STATE.json` | `version` — generated by `npm run approval:state -- --write`; test asserts it tracks `config.js` |
| `torii-quest-{strategy,todo,progress,handoff}.md` | "Current version" lines |

**NOT version markers — do NOT bump:**
- `MVP_PLAYTEST_RESULTS.md` — the human tester fills the build cells with what they actually tested; committed baseline is `not-run`.
- `LIVE_SMOKE_STATE.json` — records the DEPLOYED build a live smoke observed; legitimately lags `config.js`.
- `DASHBOARD_SMOKE_STATE.json` — same rule for the dashboard smoke.

## 5. Source of truth

**Code:**
- `src/config.js` — all constants and tuning. No scattered magic numbers.
- `src/state.js` — the ONLY place game phase changes; FSM table + weapon predicates.
- `src/main.js` — wiring only; no game logic.
- `src/sdk/index.js` — public SDK entrypoint. Curated node-safe re-exports, `SDK_VERSION`, `STABILITY` tiers, frozen `SDK_SURFACE` tier map. Only re-export modules that never transitively import `scene.js`.
- `engine/` — extracted mostly-pure SDK seams (debug, physics, combat, entities, ui, weapons). Prefer adding pure logic here so it stays node-testable.
- `CODE_INDEX.md` — file-by-file map. Update when adding/moving a module.

**Docs (project-scoped, this repo only):**
- `torii-quest-strategy.md` — vision + decision rules.
- `torii-quest-todo.md` — active task queue.
- `torii-quest-progress.md` — execution dashboard.
- `torii-quest-handoff.md` — this file.
- `VPS_INSTALL.md` — self-hosting the static build at torii.quest.
- `UPDATE_CHECK.md` — manual update-check safety boundary.
- `NOSTR_ARENA_MASTER_TODO.md` — archival history only; not an active queue.

**Safe edits to the four continuity docs** go through `npm run md:patch` (`tools/mdPatch.mjs`): whitelist-confined, per-file capability map (handoff is append-only; `replace` is rejected), `.bak` backup before every edit, no network, no arbitrary writes. The `note` action appends a timestamped bullet under the file's default heading — e.g. `npm run md:patch -- note torii-quest-progress.md "shipped X"`.

## 6. Build / test / check commands

```bash
npm install
npm run dev                 # local dev server (vite)
npm run build               # production build → dist/
npm run check               # static regression guardrails (tools/regression-check.mjs)
npm test                    # vitest — FULL unit suite (node env)

# Test profiles (v0.2.173) — deterministic curated file lists in tools/testProfiles.mjs
npm run test:fast           # ~5 core files, innermost edit→test loop
npm run test:foundation     # ~16 files, broader confidence (fast ⊆ foundation)
npm run test:release        # build + FULL vitest + check + bundle:report + handoff:status
                            # THE release gate — profiles never replace it

# Visibility / readiness tools (read-only, network-free, exit 0; NOT gates)
npm run handoff:status      # one-glance snapshot: version/pkg sync, git commit, live URL, checks, docs, reports, bundle
npm run release:status      # single READY/NOT-READY/INCOMPLETE verdict aggregating ship signals
npm run release:status:json # same verdict as JSON (or: node tools/release-readiness.mjs --json)
npm run handoff:summary     # concise brief for the next agent/model
npm run docs:stale          # advisory stale-doc detector (drift catcher; NOT in `check`)
npm run bundle:report       # advisory built-bundle size baseline
npm run zones:check         # verifies /zone/* SPA-fallback docs + dist layout (also regression-check [15])
npm run vps:dry-run         # local pre-deploy readiness checklist; exits non-zero on blocking FAIL only
npm run release:meta        # release/update metadata for the future torii.quest update-checker
npm run release:dry-run     # local GitHub MVP release dry-run; runs NO git tag/push/gh release
```

**Green** = build + check + test all pass. Docs/status drift is guarded by check `[14]`; the continuity docs must carry the current version or `npm run check` fails.

Tests run in node (`vite.config.js` → `environment: 'node'`). `WebGLRenderer` is created at module load in `scene.js`, so any module that transitively imports `scene.js` (`player.js`, `weapons.js`) CANNOT be imported in a node test. Write new logic as a pure module (no `three`/Rapier/DOM import) to keep it testable — see `engine/debug/snapshot.js`, `engine/physics/interactions.js`, `engine/physics/raycastService.js` for the pattern.

Optional headless smoke (not in CI): `npm i -D puppeteer-core`, drive Chrome with swiftshader flags against `npm run preview`, click `#btn-enter`, inspect `window.ToriiDebug.snapshot()`.

## 7. Deploy / publish (task agents may publish when explicitly instructed)

Deploy target is the pplx.app subdomain `quest-torii.pplx.app`. Build artifact is `dist/` (`npm run build`). **Maintainer shortcut: "bump and push" = bump version, update the live site quest-torii.pplx.app, and push everything to GitHub.**

**Task agents SHOULD ship end-to-end when the maintainer says "go", "publish it", "bump and push", or similar.** The pipeline is: green gate (build + check + vitest + release:status) → commit → PR → squash-merge to main → `npm run build` → deploy_website → publish_website (with site_id `93507979-679f-4aac-949d-20a4a33d7352`) → smoke test the live URL. Old handoff rule that maintainer publishes is superseded as of v0.2.365.

**publish_website shape (locked):** `project_path=/home/user/workspace/torii-quest/dist`, `dist_path=/home/user/workspace/torii-quest/dist`, `app_name='Torii Quest'`, `port=5000`, `run_command='node server/arena-ws.cjs'`, `install_command='npm install --omit=dev --no-audit --no-fund'`. Requires `dist/package.json` to exist with `ws` runtime dep — created if missing.

**Self-hosted VPS at torii.quest** is the eventual target but Sovereign Hybrid Compute VPS is currently paused — do NOT reference Namecheap or any other provider.

**Pre-publish security review is REQUIRED** — run subagent with `/home/user/workspace/skills/website-building/website-publishing/security_subagent_prompt.md` against `dist/`. Address BLOCK findings automatically; surface WARN findings to maintainer.

**Self-hosting the static build at `torii.quest`** (shared Ubuntu VPS — Caddy/Nginx + HTTPS, DNS checklist, manual GitHub update sequence, symlink rollback, security posture): see `VPS_INSTALL.md`. No server is touched from this repo.

**SPA `/zone/<slug>` deep-link rewrite (REQUIRED for hard-refresh).** The `zoneRoute` parser gives `/zone/<slug>` a safe client-side interpretation, but it only runs after `index.html` + JS have loaded. A static host will 404 on a cold hard-refresh to `/zone/<slug>` unless configured to fall back to `index.html`:
- **Nginx:** `location / { try_files $uri $uri/ /index.html; }`
- **Caddy:** `try_files {path} /index.html`
- **Static CDN / object storage:** set SPA/404 fallback document to `index.html`

Keep CSP unchanged. Same-origin in-app navigation (`history.pushState`) is unaffected. `npm run zones:check` verifies the docs describe the fallback and that `dist/` has no file shadowing `/zone/*`. Full checklist: `ZONE_FALLBACK_READINESS.md`; concrete server blocks in `VPS_INSTALL.md` §6a/§6b/§11.

## 8. Debug surface

`window.ToriiDebug` (ships in alpha):
- `.snapshot()` — one JSON-serialisable object: version, phase, run state, player pos, combat last shot/hit/miss, physics+crate summary, tuning. Safe anytime.
- `.combat.report()` / `.physics.report()` — focused JSON sub-reports.
- `.shells.*()` — read-only reports over the SDK view shells + preview blocks (gateway, product, leaderboard, updatePreview, mvpLoop, hostTransport, gatewayActivation, gatewayPortalActivation, summary, diff, surfaceSpecs, surfaceGate, …). No signer, relay, publish, navigation, checkout, or fetch. See `SDK_DEBUG_INDEX.md`.
- `.physics.service` — injectable RaycastService facade (`ray`/`rayStatic`/`lineOfSight`).
- `.bots`, `.player`, `.physics`, `.world`, `.fx`, `.combat`, `.identity`.

## 9. Active issues / open edges

- **QA-MP-BLOCKER-1 — peer discovery verified at the protocol level on chiefmonkey.art/quest/ (2026-07-13; full in-world ENTER path NOT exercised in headless).** A simulated two-npub live test against the production install confirmed the wire-level handshake and cross-client peer visibility: two isolated browser contexts, each performing a real NIP-07 nostr-login with a distinct burner npub, both opened `wss://chiefmonkey.art/mp` → received `HELLO` (`serverVersion: v0.2.366-alpha`, `protocolVersion: 1`) → sent `AUTH` (NIP-01 kind-22242, BIP-340 schnorr, challenge-bound via `window.nostr.signEvent`) → server accepted (WELCOME returned). **B's `WELCOME.roster` contained A**, and **A received a `JOIN` frame for B** (`{id, npub, pos, rot, character}`). So the auth gate, roster fan-out, and JOIN broadcast are confirmed working on the live install.
- **v0.2.370-alpha — base-aware pinned-entry import fixed (ENTER ARENA no longer freezes under the `/quest/` mount); LIVE still v0.2.366-alpha until Suite redeploy.** A real-browser test on chiefmonkey.art/quest/ (v0.2.369-alpha, Brave + Firefox) found the pre-auth menu responsive but clicking **ENTER ARENA froze the session** before any canvas/frame — the arena never booted. Root cause: the vite CSP plugin (`vite.config.js`) emitted the pinned-entry URL **root-relative** (`/assets/torii-entry.js?v=<stamp>`) for BOTH the inline bootstrap `import()` and every chunk's back-reference import of the entry. Under the Suite's `--base=/quest/` build those URLs 404 at host root; because `arenaRuntime.js` statically imports the entry, ENTER ARENA's `import('./arenaRuntime.js')` graph load REJECTED and the arena never started (live symptom: freeze). Fix: the plugin now captures the resolved deploy base (`configResolved`) and emits `${base}assets/torii-entry.js?v=<stamp>` (`/quest/…` on the Suite, `/…` at root) via a single `entryUrl(base)` helper, applied to the inline import, the removal regexes, and the chunk rewrite. `tools/regression-check.mjs` [16] base-agnostic; new deterministic regression `tests/quest-base-entry.test.js` does a real `--base=/quest/` build and asserts every `torii-entry.js?v=` URL carries the `/quest/` base, is byte-identical (single module instance), and that no static entry `<script>` survives. Verified: `--base=/quest/` build emits `/quest/assets/torii-entry.js?v=<stamp>` everywhere; puppeteer ENTER-ARENA repro on a clean `/quest/` server boots the arena (frames advance, no "Failed to fetch dynamically imported module"). 2269/2269 tests, checks green. **Source-only fix — the Suite installer is pinned at `TORII_QUEST_REF=v0.2.367-alpha`, so the maintainer must first bump the Suite Quest ref to v0.2.370-alpha (or the merge commit), then a Suite redeploy (which builds with `--base=/quest/`) will include it; do NOT touch the VPS while the Continuum session is active on the shared host.** No gameplay/physics/CSP-policy/Nostr change; the v0.2.369 assetUrl fix is untouched.
- **v0.2.369-alpha — root-relative asset paths fixed (graphics + peer-avatar visibility); LIVE still v0.2.366-alpha until Suite redeploy.** A real-browser two-npub test (Firefox + Brave) on chiefmonkey.art/quest/ confirmed the arena loads and peers auth/join, but **no `.glb` models load** (bots fall back to capsule "pills") and **peer avatars never appear** (players can't see one another) — the peer-avatar `avatarLoader` has no fallback on GLB failure. Root cause: all `GLTFLoader.load('/foo.glb')`, `setDecoderPath('/draco/')`, and `TextureLoader.load('/bitcoin-b.png')` in `src/` were **root-relative**; under the `/quest/` mount they 404 at host root (confirmed: root 404, `/quest/` 200). Fix: new `src/assetUrl.js` helper (`${import.meta.env.BASE_URL}${name}`, mirroring `audio.js`) applied across 8 source files (8 GLB loads, 6 Draco paths, 1 texture, `char.file`); `tools/regression-check.mjs` [16] now requires `assetUrl('/draco/')` and FAILS on any bare root-relative `.load('/...glb|png|…')`. Verified: a `--base=/quest/` build inlines `/quest/` + passes all GLB args to the helper; 2264/2264 tests, 20/20 checks. **Source-only fix — the Suite installer is pinned at `TORII_QUEST_REF=v0.2.367-alpha`, so the maintainer must first bump the Suite Quest ref to v0.2.369-alpha (or the merge commit), then a Suite redeploy (which builds with `--base=/quest/`) will include it; do NOT touch the VPS while the Continuum session is active on the shared host.** H4 NOT closed until a real-browser retest on the redeployed build shows both avatars in-world. SW follow-up (non-blocking): `public/sw.js` registration + precache are still root-relative and don't register under `/quest/`; the game loads via network regardless.
  - **NOT confirmed in this test:** the full in-world arena render + roster visualisation via the app's normal `ENTER ARENA` → `boot()` path. Under headless software-WebGL (swiftshader) the arena's render loop starves the async NIP-07 callback, so `signEvent` does not resolve before the 10s `AUTH_TIMEOUT_MS` when driven through the full 3D flow; the test therefore drove the AUTH handshake directly in-page (same `wss://chiefmonkey.art/mp`, same `window.nostr` shim) to isolate the protocol path. This is a **headless test-environment limitation, not proven to be free of a product-side rendering/roster-visualisation issue (H4)** — re-verify the full ENTER→in-world path on real GPU hardware before closing H4.
  - H2 (MP not eagerly loaded) and H3 (silent AUTH rejection) are not implicated by this test (both peers authed and received WELCOME/JOIN), but were not directly exercised through the ENTER button either.
  - The original pplx.app symptom was solely the broken pplx.app backend sandbox (still 503), now bypassed by the SHC VPS install. Full evidence in `torii-quest-todo.md` §QA-MP-BLOCKER-1.
- **Deployment conventions — chiefmonkey.art (Torii Suite install; source of truth: `torii-quest-todo.md` → “Deployment conventions — chiefmonkey.art”).** Quest is live via the **Torii Suite** installer (`torii-suite` v0.7.0-alpha), NOT the ad-hoc Caddy bundle. Frontend mounts at the path prefix **`/quest/`** (root `/` 404s — no launcher mounted yet). Multiplayer WS is the root-level same-origin **`wss://chiefmonkey.art/mp`** (no `/port/5000/mp` sentinel on the VPS path — that sentinel is pplx.app-sandbox-only; `multiplayerHost.resolveUrl()` resolves to `wss://chiefmonkey.art/mp`). Backend is the hardened systemd unit **`torii-arena-ws.service`** (`User=torii-quest`, `127.0.0.1:8788`, `NoNewPrivileges`/`ProtectSystem=strict`); nginx `location /mp` → `127.0.0.1:8788` (WS upgrade) via `/opt/torii/nginx-fragments/quest-mp.conf`. Apps mount as path prefixes via fragments in `/opt/torii/nginx-fragments/<app>.conf` under one domain; the shared parent `/opt/torii` stays `root:root 0755` (world-traversable) — NEVER re-own/re-mode it (v0.2.30 permission-regression fix). Siblings: Continuum `/continuum/` (agent `127.0.0.1:8787`, API `/api/`), Plebeian `/plebeian/`. A Continuum session is actively managing onboarding on this shared host — do NOT touch shared nginx/parent-dir config while that work is in flight. Suite installer: `curl -fsSL https://raw.githubusercontent.com/ChiefmonkeyArt/torii-suite/v0.7.0-alpha/bootstrap.sh | sudo bash`; pinned `TORII_QUEST_REF=v0.2.367-alpha` (live `arena-ws` advertises v0.2.366-alpha in HELLO — the live build predates the v0.2.369-alpha source bump; cosmetic, no functional impact).
- **Travel-time lead on fast-moving targets** — bullets are hitscan-aimed but projectile-flown; long shots on strafing bots can trail. Tracked in `torii-quest-todo.md`.
- **pplx.app backend sandbox BROKEN (2026-07-11; SECONDARY host, now bypassed by chiefmonkey.art — kept as fallback).** v0.2.366-alpha published to quest-torii.pplx.app via `publish_website` (status:published, `visibility_setting: Public`). Static frontend serves (HTTP 200) but the **backend sandbox is not running** — `/port/5000/healthz` returns empty 503 in ~0.2s (fast rejection, not a cold start; a 90s-timeout probe still 503s in 0.198s). WS upgrade OPENs at the proxy but no HELLO arrives. Server code is verified healthy: clean-room replication of the exact production boot (`npm install --omit=dev` → `node server/arena-ws.cjs` PORT=5000) gives `/healthz` 200 `{"ok":true,"version":"v0.2.366-alpha"}` + WS `HELLO` in 7ms. Two republishes did not change the 503. Residual platform-side backend-hosting degradation from the 32h bridge outage (diagnostic `9a174646`). **Decision (2026-07-11): move the live backend to the SHC VPS at chiefmonkey.art** (single-origin, VPS_INSTALL.md §16) — bypasses the broken pplx.app backend entirely. Ready-to-run deploy bundle built: `torii-quest-vps-deploy-v0.2.366-alpha.tar.gz` (dist + Caddy site block + systemd unit + idempotent `deploy.sh`; CSP baked from the build with inline-script sha `8RxbohhIbgMGQaBj0CcykJ4wbu0FIyUvCrGVRHXu8xE=`). VPS was paused — unpause first; DNS (apex + www A records → VPS) confirmed by maintainer. Once up: `sudo bash deploy.sh` → smoke `wss://chiefmonkey.art/mp` (expect HELLO v0.2.366-alpha) → two-npub test.
- **ESBUILD-1** (deferred) — low-severity dev-server-only esbuild advisory. `npm audit fix` pulls a broad rolldown/vite chain, deemed too risky for alpha. Tracked WARN in `torii-quest-todo.md`.
- ~~**SEC-1 (mandatory gate on `leaderboardPublisher`)**~~ — **LANDED v0.2.355-alpha.** The `createLeaderboardPublisher({ sign, publish, gate })` adapter no longer treats `gate` as optional: `gate` DEFAULTS to `verifyPublishGate` (the crypto-verified SEC-1 gate), so any live publisher inherits real BIP-340 verification + the consent check by default. An explicit `gate: null` combined with a wired `publish` is a SEC-1 CONSTRUCTION ERROR — `publishScore` fails closed on every call, never signs, never publishes, and returns `ok:false` with a `SEC-1: publish is wired without a gate` error. The build-only path (no publisher) still needs no gate. This closes the earlier bypass where a caller could wire `{ sign, publish }` without a gate and quietly ship stub-signed or unverified events to a relay. Tests: 5 new cases across `tests/leaderboard-publisher.test.js` (mandatory-gate fail-closed describe block) and `tests/leaderboard-publish-gate.test.js` (the old "backward compatible" bypass test flipped to two fail-closed assertions). Consent gating for the real signer/relay wiring landed earlier (v0.2.257 publishGate, v0.2.277 real BIP-340, v0.2.285 live NIP-07); v0.2.355 removes the last opt-out path.
- ~~**SEC-2 (handoff verification on `world/handoff.js`)**~~ — **LANDED v0.2.356-alpha.** The traveller-side handoff skeleton (`src/world/handoff.js`) now runs real BIP-340 schnorr verification before it hands a caller a spawn descriptor. New `verifyHandoffCrypto(h, { expectedPlayerPubkey, now, requireFresh })` composes the pure structural pre-flight (schema/namespace/freshness) with a re-derived NIP-01 event id + `schnorr.verify(h.sig, h.id, h.player)` under the traveller's hex64 pubkey, mirroring the SEC-2 gateway gate in `engine/gateway/handoffVerify.js` and the SEC-1 leaderboard gate. `resolveHandoffSpawn(h, destZoneMeta, { expectedPlayerPubkey })` is the choke-point: the `expectedPlayerPubkey` opt is REQUIRED (must be hex64) and the crypto verdict must be trusted, so an unsigned envelope, a tampered body, a wrong-key signature, or an envelope naming a different traveller returns null. New helpers `deriveHandoffId(h)` (pure, so signer + verifier agree on what the sig commits to) and `signHandoffEvent(h, sk)` (test/demo convenience, injected sk only) round out the module. Tests: 32 new cases in `tests/world-handoff.test.js` covering constants, factory shape, structural verify parity, id derivation, sign+verify round-trip, malformed opts, identity mismatch, tampered body, stub sig, wrong-key sig, freshness gate, resolveHandoffSpawn fail-closed matrix, and serialize/deserialize sig preservation. Historical crypto SEC-2 in the gateway path (`handoffVerify.js`, live-signature verify) landed earlier at v0.2.252 (structural) and v0.2.263 (real BIP-340); v0.2.356 completes SEC-2 on the traveller/arrival side. **Note:** live relay ingest still requires the maintainer to wire `resolveHandoffSpawn` into whatever transport lands `h` — the module has no relay layer yet.
- ~~**SEC-3 (product URL validation)**~~ — **LANDED v0.2.354-alpha.** `productDisplay.isSafeHttpUrl` (the shared validator both `productDisplay` and the `productPanel` view-model use) is now a WHATWG `URL`-object parser: it trims + rejects any embedded whitespace, tries `new URL(s)`, and only accepts a result whose `protocol === 'https:'` and whose `hostname` is non-empty. The old regex `^https:\/\/[^\s]+$` accepted malformed inputs like `https://` and `https:javascript:…`; the parser refuses them and normalises the permissive-but-safe cases (`https:host`, `https:///host`, `HTTPS://`) to a real https host, so a listing can no longer smuggle a non-https scheme through us. Tests: 6 new cases in `tests/product-display.test.js` locking scheme/host enforcement, malformed rejection, WHATWG normalisation behaviour, and non-string safety.

## 10. Next-job format

When picking up work, state it as:

```
TASK:        <one line>
VERSION:     bump v0.2.<n> → v0.2.<n+1>-alpha
CONSTRAINTS: (default = all of §3; note any the task explicitly relaxes)
SCOPE:       files expected to change; split by concern
DONE WHEN:   build + check + test green; docs (§5) updated; version markers (§4) bumped
DEPLOY:      NO (maintainer publishes) unless explicitly instructed
```

Keep changes incremental and reversible. If scope balloons, stop at a green checkpoint and report what remains rather than half-landing a broad rewrite.
