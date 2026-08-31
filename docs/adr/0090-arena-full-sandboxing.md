# ADR-0090 — Arena full sandboxing (Three + Rapier inside the napplet iframe)

**Status:** Proposed · **Date:** 2026-08-31
**Deciders:** chiefmonkey
**Related:** ADR-0057 (NappletSurface), ADR-0082 (game host shell), ADR-0084 (arena wiring-only), ADR-0092 (release-time napplet identity, planned), ADR-0091 (sticker studio full sandboxing, deferred)

## Context

ADR-0084 registered the arena as a `torii-arena` game napplet through the ADR-0082 `game.*` contract, but the arena runtime still runs Three + Rapier in the *main* window. Every `game.event.publish` and `game.player.get` in the current wiring goes through injected callbacks that look identical to a real napplet's, but the arena itself is a first-party consumer with full DOM access and full main-thread access. That is deliberate scope for ADR-0084 — wire the contract now, sandbox later — but it caps how much freedom the arena can promise a Continuum instance or a third-party embedder: today it can only run the *code Torii Quest itself ships*, because the arena is not in fact inside the trust boundary.

Two things need proving to turn the arena into a real sandboxed napplet: (1) Three + Rapier can render and simulate inside a `sandbox="allow-scripts"` iframe with only DOM + `postMessage` access to the shell, at a frame budget the shell can absorb, and (2) inputs (pointer, keyboard, gamepad) and outputs (score, multiplayer state, exit) still flow through the `game.*` contract without a leak that would need `allow-same-origin` or a direct handle to the main-window scene graph. Both are open questions that need a proper design before code lands.

Full sandboxing is *not* a rewrite of the arena. The arena runtime keeps its shape (`createArenaRuntime(hooks)`), the multiplayer wire (`arena-ws`) keeps its shape, the combat values are frozen. What changes is the *shell* the runtime executes inside, and the transport that carries its inputs and outputs.

## Decision

**This ADR is design-only. No code changes yet.**

1. **Sandbox model.** Render + simulate inside a `sandbox="allow-scripts"` iframe (same trust boundary as the product and avatar shells: opaque origin, no `allow-same-origin`, `MessageEvent.source` validated, per-mount channelId nonce, CSP `default-src 'none'; connect-src 'none'; img-src 'none'`). The iframe hosts Three, Rapier, and the arena runtime; the main window hosts only the shell, the multiplayer wire, and the DOM overlays that must reach the trusted DOM (leaderboard, product boards, settings).

   **WebGL surface:** the iframe creates its **own** `<canvas>` internally and gets a WebGL2 context on it. The main window's shell composes the arena visually via CSS layering (the iframe sits at its `NappletGameHost` mount rect, z-ordered under overlays). The iframe itself sets `pointer-events: none` so the shell's overlay `<div>` above it captures all pointer input — the sandbox never receives pointer events directly, only the broker-forwarded `game.input.*` envelopes. No OffscreenCanvas transfer across the origin boundary — Safari's support for that path is inconsistent and the ADR is not willing to bet the sandbox on it. No shared memory, no `SharedArrayBuffer`. Browser target for step 2 is Chromium + Firefox + Safari with a same-configuration sandbox on all three.

   **Rapier WASM delivery:** the arena bundle **inlines** Rapier's `.wasm` as a base64 payload and instantiates via `WebAssembly.instantiate(new Uint8Array(base64Decode(payload)))`. No runtime fetch, so `connect-src 'none'` stays intact. Cost is a ~500 KB payload inside the bundle JS (base64 inflates by 4/3, so ~670 KB pre-gzip, ~180 KB gzipped — measured on Rapier 0.14). The bundler config (rollup `@rollup/plugin-wasm` in inline mode) is captured as an implementation note under migration step 2.

2. **DOM<->WebGL bridge.** Pointer, keyboard, and gamepad events captured on the shell's overlay `<div>` (the same div the iframe covers) are normalised into a small `game.input.*` envelope stream:
   - `game.input.pointer` — `{ t, kind: 'down'|'up'|'move', x, y, buttons }` in shell-local coordinates.
   - `game.input.key` — `{ t, kind: 'down'|'up', code }`.
   - `game.input.gamepad` — `{ t, index, buttons, axes }` fired at **fixed 60 Hz** (independent of the shell's `rAF`, which may run at 120/144 Hz or throttle on background tabs). The shell runs a `setInterval`-driven poller while a game surface is focused; the arena's aim math consumes gamepad samples at simulation rate.

   **Pointer-lock: shell-hosted, deltas forwarded (decided, not open).** The shell owns `requestPointerLock()` on the overlay `<div>` on user gesture; the arena inside the sandbox never touches `document.pointerLockElement`, never requests lock, never reads `movementX/movementY` directly. The shell forwards lock state and per-tick accumulated deltas as:
   - `game.input.pointerlock.state` — `{ locked: bool }` on transition.
   - `game.input.pointerlock.delta` — `{ t, dx, dy }` **once per `game.tick`**, where `dx`/`dy` are the sum of all `movementX/movementY` deltas since the previous tick.

   **Deltas are coalesced, not forwarded raw.** A gaming mouse fires `mousemove` at 500-1000 Hz, but the sandbox only samples inputs at 60 Hz on `game.tick`. The shell accumulates `movementX/movementY` between ticks and posts a single `game.input.pointerlock.delta` per tick. This preserves total movement (no dropped samples — the sum is exact) and keeps the pointer stream a fixed ~2 KB/s instead of an unbounded 500-1000 Hz message flood.

   This costs one frame of aim lag (the shell reads the delta, posts it, the sandbox applies it on the next tick) but is the only pointer-lock model that keeps the sandbox honest: a sandbox-owned lock either needs `allow-same-origin` (defeats the boundary) or triggers browser refusal on cross-origin lock. One frame at 60 Hz is 16.7 ms — well below the ~50 ms perceptual threshold for aim.

   Every DOM read is shell-brokered.

3. **Per-frame snapshot protocol.** The arena publishes a `game.frame.snapshot` at **fixed 60 Hz** (shell-driven: the shell posts `game.tick { t }` at its `rAF` throttled to 60 Hz, the sandbox responds with a snapshot for that tick). Shell-driven cadence keeps the bridge decoupled from the sandbox's own rAF timing and gives the shell one throttle point for both the input stream and the snapshot stream.

   The snapshot is a compact fixed-layout object — not the Three scene graph — and carries only what the shell needs for its overlays and MP wire:
   - `{ t, player: { pos, yaw, health, score, kills }, weapon: { kind, ammo, reloading }, peers: [{ id, pos, yaw, alive }], events: [ { kind: 'shot'|'hit'|'kill'|'exit', ... } ] }`.

   **Cost budget (napkin, to be validated in migration step 1):** with 16 peers and 4 events/tick, one snapshot is ~1.4 KB uncompressed (player ~40 B + weapon ~24 B + 16 × ~48 B peers + 4 × ~64 B events + ~200 B envelope overhead ≈ 1.4 KB). At 60 Hz that is **~84 KB/s one-way**, plus the input stream in the other direction (~5-10 KB/s typical, ~2 KB/s coalesced pointer-lock deltas). Total bridge cost ≈ 90-95 KB/s of structured-clone traffic on a target machine. **Budget ceiling: 250 KB/s combined bridge traffic on the p95 machine, per mount.** Multi-mount scales proportionally (two arenas ≈ 180-190 KB/s); the ceiling is enforced per mount so a second surface cannot silently blow the first's budget. Migration step 1 lands the snapshot shim with a benchmark harness that measures the actual number against a 32-peer worst case; step 2 does not proceed if the p95 measurement exceeds the ceiling.

   Nothing WebGL-shaped crosses the boundary. The MP wire on the main window reads snapshots and sends `SHOT`/`HIT`/`STATE` on `arena-ws`; incoming MP state is injected as `game.frame.inject { peers, authoritativeHits }`. **Injection is applied at the arena's next tick boundary, never mid-tick** — the arena's rewind/reconcile path (unchanged from current behaviour) handles peer teleports and out-of-order state. Inject is treated as a hint the arena reconciles against; the arena tick remains authoritative for local player physics.

4. **Bundle model.** The arena napplet ships as a static bundle addressed by the `NAPPLET_IDENTITY` hash ADR-0092 will assign. The bundle carries its own Three + Rapier vendor chunks; the shell keeps its own copies for the world/product/avatar surfaces. Duplicate cost is real — the "Rapier WASM ≈ 500 KB" figure is **the same inlined-base64 payload described in §1** (≈ 180 KB gzipped), and three-vendor ≈ 700 KB — but bounded: the shell caches by hash, so the second load is free. This is the trade the sandbox buys: the shell's Three/Rapier and the arena's Three/Rapier are never the same objects, which is exactly the point.

5. **Migration path.** Ship in three PRs, each independently mergeable:
   1. **Snapshot-only shim.** `arenaRuntime.js` gains a `readFrameSnapshot()` method that the current in-window bootstrap ignores, plus tests that lock the snapshot shape. No behaviour change on live.
   2. **Iframe host + bridge.** New `NappletArenaSandbox` (a specialisation of `NappletGameHost`) that mounts the arena bundle in an iframe, wires the `game.input.*` stream in, wires the `game.frame.snapshot` stream out, keeps `game.event.publish` shell-brokered. Feature-flagged; the in-window arena still ships until the flag flips.
   3. **Flag flip + old path deletion.** Once the sandboxed arena passes a full multiplayer smoke test on `chiefmonkey.art/quest/` and `torii.plebeian.build`, delete the in-window bootstrap.

6. **Non-goals for this ADR.**
   - Not a rewrite of `arenaRuntime.js`. Same runtime, new shell around it.
   - Not a change to `arena-ws` or the MP wire. The wire still runs on the main window; only the snapshot-in / state-inject seam is new.
   - Not a change to the combat values, LAG_COMP_MS, or the hit classifier. Frozen.
   - Not a change to signing or publishing. `game.event.publish` still goes through `signEvent` + `fanoutPublish` in `main.js`.

7. **ADR-0092 dependency (cross-cutting).** Migration step 3 (flag flip + old-path delete) **must not land before ADR-0092** — otherwise the arena ships in production with `NAPPLET_IDENTITY = 'torii-arena@v0-wiring'` and the character event's `contrib` tag records a placeholder rather than a real bundle hash. Steps 1 and 2 are safe under the placeholder because the sandboxed arena runs alongside the in-window arena behind the feature flag; only step 3 makes the placeholder authoritative. The bundle-loading protocol (`/napplets/{hash}/index.html` vs. data-URL vs. separate origin) is also pending ADR-0092.

## Consequences

- **Enables:** third-party games mounted through the `game.*` contract with the same trust boundary as the product panel, a real napplet-vs-shell surface for the Torii DE Doctor + Studios flows, honest `contrib` provenance on the character event because the arena is genuinely a sandboxed contributor.
- **Forecloses:** any arena code touching the main window directly. Every DOM read, every scene-graph read, every relay hit is shell-brokered.
- **Trade-offs:** duplicated Three + Rapier bundle in the arena bundle (cached, bounded), a small per-frame snapshot cost (~1.4 KB per tick at 60 Hz ≈ 84 KB/s — the design point ADR-0090 exists to prove is fine against the 250 KB/s budget), and a new bridge to keep in sync with `arena-ws` state. The alternative is worse: two contracts, one for "trusted napplets we ship" and one for "third-party napplets," which is exactly the trap the napplet model was built to avoid.
- **Enforcement:** unit tests lock the `game.input.*` envelope shape, the `game.frame.snapshot` shape, and the per-mount channelId enforcement carries over unchanged. Integration tests mount the arena bundle in a real iframe under jsdom + a fake `postMessage` transport and drive a headless MP smoke. **jsdom does not enforce `sandbox` origin isolation** — the jsdom suite validates envelope shapes and channelId enforcement; a real-browser smoke (Playwright against the deployed URL) validates the sandbox itself.
- **Crash recovery** (behaviour inherited from `NappletGameHost`, no new mechanism here): a sandboxed arena whose script context dies (uncaught exception, WASM trap) stops answering `game.tick`. The shell detects N consecutive missed ticks and surfaces `napplet-unresponsive` in the host chrome rather than silently freezing the viewport. A full auto-reload / restart spec is deferred to a host-lifecycle ADR; ADR-0090 only commits to the detection-and-surface behaviour.

## Alternatives considered

- **`allow-same-origin` sandbox with a direct scene-graph handle.** Rejected — that gives the arena a real origin and defeats the whole point of the trust boundary. Any bug in the arena becomes an XSS on the shell.
- **Web Worker instead of iframe.** Rejected — a Worker cannot run WebGL (OffscreenCanvas from a Worker is supported on some browsers but not on Safari as of writing, and the Torii Quest target is browser-agnostic). An iframe with `sandbox="allow-scripts"` is uniformly supported and gives the same origin isolation.
- **Snapshot the Three scene graph instead of a domain-shaped snapshot.** Rejected — that couples the wire to Three's internals. A compact domain snapshot lets the shell change renderers without changing the contract.
- **Run the MP wire inside the sandbox.** Rejected — the wire needs `WebSocket` to `arena-ws` on the shell's origin. Moving it into the sandbox would need `connect-src` widened, which is exactly the CSP the shell exists to enforce.
- **Do full sandboxing before wiring (skip ADR-0084).** Rejected — see ADR-0084. Doing wiring first lets both directions converge on the same contract instead of designing the sandbox first and refactoring the contract.

## Notes

Design doc only. No files added, no tests added. First implementation PR is the snapshot-only shim (migration step 1) and lands under its own PR after this ADR is accepted.

**Decisions locked in this revision (previously open):**

- Snapshot cadence: **shell-driven** at fixed 60 Hz (shell posts `game.tick`, sandbox responds with snapshot). One extra message per frame is accepted; it decouples cadence from the sandbox's rAF and gives the shell one throttle point.
- Pointer-lock: **shell holds the lock, forwards deltas**. One frame of aim lag is well below perceptual threshold.
- Rapier WASM: **inlined base64**, no runtime fetch, `connect-src 'none'` preserved.
- WebGL surface: **iframe-owned `<canvas>` composed via CSS layering**, no OffscreenCanvas transfer (Safari-safe).
- Bridge cost budget: **250 KB/s combined**, validated by benchmark in migration step 1 before step 2 lands.

**Still open (deferred to migration-step review, not blocking this ADR):**

- Multiplayer authoritative hits: does the shell re-run the hit classifier on `SHOT` messages before injecting, or does it trust the sandbox's snapshot? Trusting the sandbox is fine for v0 (the server is still authoritative), but a shell-side classifier would let the shell reject a snapshot that lies about a hit. Decision defers to step 2 wiring PR — either choice preserves the trust boundary.
- Debugging story: shape of an owner-gated `game.debug.dump` (last N snapshots + last N inputs). Design lands with step 2.
- Bundle load failure mode: shell UX for a 404 or hash-mismatch on bundle fetch. Depends on ADR-0092 bundle-loading protocol.
- Multi-mount: two arenas side-by-side (spectator + play). Per-mount channelId design already supports it; whether the UI exposes it is a product decision, not a design one.
