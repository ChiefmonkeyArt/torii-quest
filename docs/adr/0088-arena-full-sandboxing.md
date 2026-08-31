# ADR-0088 — Arena full sandboxing (Three + Rapier inside the napplet iframe)

**Status:** Proposed · **Date:** 2026-08-31
**Deciders:** chiefmonkey
**Related:** ADR-0057 (NappletSurface), ADR-0082 (game host shell), ADR-0084 (arena wiring-only), ADR-0086 (release-time napplet identity, deferred), ADR-0089 (sticker studio full sandboxing, deferred)

## Context

ADR-0084 registered the arena as a `torii-arena` game napplet through the ADR-0082 `game.*` contract, but the arena runtime still runs Three + Rapier in the *main* window. Every `game.event.publish` and `game.player.get` in the current wiring goes through injected callbacks that look identical to a real napplet's, but the arena itself is a first-party consumer with full DOM access and full main-thread access. That is deliberate scope for ADR-0084 — wire the contract now, sandbox later — but it caps how much freedom the arena can promise a Continuum instance or a third-party embedder: today it can only run the *code Torii Quest itself ships*, because the arena is not in fact inside the trust boundary.

Two things need proving to turn the arena into a real sandboxed napplet: (1) Three + Rapier can render and simulate inside a `sandbox="allow-scripts"` iframe with only DOM + `postMessage` access to the shell, at a frame budget the shell can absorb, and (2) inputs (pointer, keyboard, gamepad) and outputs (score, multiplayer state, exit) still flow through the `game.*` contract without a leak that would need `allow-same-origin` or a direct handle to the main-window scene graph. Both are open questions that need a proper design before code lands.

Full sandboxing is *not* a rewrite of the arena. The arena runtime keeps its shape (`createArenaRuntime(hooks)`), the multiplayer wire (`arena-ws`) keeps its shape, the combat values are frozen. What changes is the *shell* the runtime executes inside, and the transport that carries its inputs and outputs.

## Decision

**This ADR is design-only. No code changes yet.**

1. **Sandbox model.** Render + simulate inside a `sandbox="allow-scripts"` iframe (same trust boundary as the product and avatar shells: opaque origin, no `allow-same-origin`, `MessageEvent.source` validated, per-mount channelId nonce, CSP `default-src 'none'; connect-src 'none'; img-src 'none'`). The iframe hosts Three, Rapier, and the arena runtime; the main window hosts only the shell, the multiplayer wire, and the DOM overlays that must reach the trusted DOM (leaderboard, product boards, settings). A single OffscreenCanvas passed by `postMessage` on mount is the WebGL surface; no shared memory, no `SharedArrayBuffer`.

2. **DOM<->WebGL bridge.** Pointer, keyboard, and gamepad events captured on the shell's overlay `<div>` (the same div the iframe covers) are normalised into a small `game.input.*` envelope stream:
   - `game.input.pointer` — `{ t, kind: 'down'|'up'|'move', x, y, buttons }` in shell-local coordinates.
   - `game.input.key` — `{ t, kind: 'down'|'up', code }`.
   - `game.input.gamepad` — `{ t, index, buttons, axes }` polled at the shell's animation frame.
   Pointer-lock is proxied: the shell requests pointer-lock on user gesture, forwards the lock/unlock transitions as `game.input.pointerlock`, and the arena runs its aim math inside the sandbox using deltas from `movementX/movementY` that the shell forwards. The arena never touches `document.pointerLockElement` directly — every DOM read is shell-brokered.

3. **Per-frame snapshot protocol.** The arena publishes a `game.frame.snapshot` at its own tick rate (60 Hz nominal, throttled to the shell's `requestAnimationFrame` on the main window). The snapshot is a compact fixed-layout object — not the Three scene graph — and carries only what the shell needs for its overlays and MP wire:
   - `{ t, player: { pos, yaw, health, score, kills }, weapon: { kind, ammo, reloading }, peers: [{ id, pos, yaw, alive }], events: [ { kind: 'shot'|'hit'|'kill'|'exit', ... } ] }`.
   Nothing WebGL-shaped crosses the boundary. The MP wire on the main window reads snapshots and sends `SHOT`/`HIT`/`STATE` on `arena-ws`; incoming MP state is injected as `game.frame.inject { peers, authoritativeHits }` and the arena applies it on its next tick. This is the design point that ADR-0088 exists to prove: the snapshot is small enough, and stable enough, that a snapshot-based bridge is not a bottleneck at 60 Hz on target hardware.

4. **Bundle model.** The arena napplet ships as a static bundle addressed by the `NAPPLET_IDENTITY` hash ADR-0086 will assign. The bundle carries its own Three + Rapier vendor chunks; the shell keeps its own copies for the world/product/avatar surfaces. Duplicate cost is real (Rapier WASM ≈ 500 KB, three-vendor ≈ 700 KB) but bounded — the shell caches by hash, so the second load is free. This is the trade the sandbox buys: the shell's Three/Rapier and the arena's Three/Rapier are never the same objects, which is exactly the point.

5. **Migration path.** Ship in three PRs, each independently mergeable:
   1. **Snapshot-only shim.** `arenaRuntime.js` gains a `readFrameSnapshot()` method that the current in-window bootstrap ignores, plus tests that lock the snapshot shape. No behaviour change on live.
   2. **Iframe host + bridge.** New `NappletArenaSandbox` (a specialisation of `NappletGameHost`) that mounts the arena bundle in an iframe, wires the `game.input.*` stream in, wires the `game.frame.snapshot` stream out, keeps `game.event.publish` shell-brokered. Feature-flagged; the in-window arena still ships until the flag flips.
   3. **Flag flip + old path deletion.** Once the sandboxed arena passes a full multiplayer smoke test on `chiefmonkey.art/quest/` and `torii.plebeian.build`, delete the in-window bootstrap.

6. **Non-goals for this ADR.**
   - Not a rewrite of `arenaRuntime.js`. Same runtime, new shell around it.
   - Not a change to `arena-ws` or the MP wire. The wire still runs on the main window; only the snapshot-in / state-inject seam is new.
   - Not a change to the combat values, LAG_COMP_MS, or the hit classifier. Frozen.
   - Not a change to signing or publishing. `game.event.publish` still goes through `signEvent` + `fanoutPublish` in `main.js`.

## Consequences

- **Enables:** third-party games mounted through the `game.*` contract with the same trust boundary as the product panel, a real napplet-vs-shell surface for the Torii DE Doctor + Studios flows, honest `contrib` provenance on the character event because the arena is genuinely a sandboxed contributor.
- **Forecloses:** any arena code touching the main window directly. Every DOM read, every scene-graph read, every relay hit is shell-brokered.
- **Trade-offs:** duplicated Three + Rapier bundle in the arena bundle (cached, bounded), a small per-frame snapshot cost (~5-10 KB at 60 Hz — the design point ADR-0088 exists to prove is fine), and a new bridge to keep in sync with `arena-ws` state. The alternative is worse: two contracts, one for "trusted napplets we ship" and one for "third-party napplets," which is exactly the trap the napplet model was built to avoid.
- **Enforcement:** unit tests lock the `game.input.*` envelope shape, the `game.frame.snapshot` shape, and the per-mount channelId enforcement carries over unchanged. Integration tests mount the arena bundle in a real iframe under jsdom + a fake `postMessage` transport and drive a headless MP smoke.

## Alternatives considered

- **`allow-same-origin` sandbox with a direct scene-graph handle.** Rejected — that gives the arena a real origin and defeats the whole point of the trust boundary. Any bug in the arena becomes an XSS on the shell.
- **Web Worker instead of iframe.** Rejected — a Worker cannot run WebGL (OffscreenCanvas from a Worker is supported on some browsers but not on Safari as of writing, and the Torii Quest target is browser-agnostic). An iframe with `sandbox="allow-scripts"` is uniformly supported and gives the same origin isolation.
- **Snapshot the Three scene graph instead of a domain-shaped snapshot.** Rejected — that couples the wire to Three's internals. A compact domain snapshot lets the shell change renderers without changing the contract.
- **Run the MP wire inside the sandbox.** Rejected — the wire needs `WebSocket` to `arena-ws` on the shell's origin. Moving it into the sandbox would need `connect-src` widened, which is exactly the CSP the shell exists to enforce.
- **Do full sandboxing before wiring (skip ADR-0084).** Rejected — see ADR-0084. Doing wiring first lets both directions converge on the same contract instead of designing the sandbox first and refactoring the contract.

## Notes

Design doc only. No files added, no tests added. First implementation PR is the snapshot-only shim (migration step 1) and lands under its own PR after this ADR is accepted.

Open questions for review:

- Snapshot cadence: fixed 60 Hz inside the sandbox with the shell throttling to `rAF`, or shell-driven (shell posts `game.tick` at `rAF` and the sandbox responds with a snapshot)? Shell-driven is simpler but adds one message round-trip per frame.
- Pointer-lock: does the shell hold the lock and forward deltas, or does the sandbox request the lock on the shell's div? Holding on the shell is safer (no origin-boundary weirdness) but adds a proxy hop for movement events.
- Multiplayer authoritative hits: does the shell re-run the hit classifier on `SHOT` messages before injecting, or does it trust the sandbox's snapshot? Trusting the sandbox is fine for v0 (the server is still authoritative), but a shell-side classifier would let the shell reject a snapshot that lies about a hit.
