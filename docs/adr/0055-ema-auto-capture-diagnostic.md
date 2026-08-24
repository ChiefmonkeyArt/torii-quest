# ADR-0055: Ema Auto-Capture Diagnostic (1Hz Rolling Ring)

## Date
2026-08-24

## Status
Proposed

## Context
The owner reports transient gameplay glitches — "phantom" bots (floating nameplates
with no body, or bots that teleport) and desync "shooting with no effect" — that
disappear too fast to capture with a manual `K`-press ema. The manual ema flow
(`kamiMode.js` → `requestFrameGrab` + `safeSnapshot` → `sealAndPost`) captures one
frame + one combat snapshot at the moment the owner presses K, but by then the
phantom is gone.

The infrastructure to fix this already exists:
- `scene.js` `requestFrameGrab(cb)` grabs the canvas inside the render tick at
  zero cost when the queue is empty (no `preserveDrawingBuffer` tax).
- `kamiStore.js` already ring-buffers `shots/` to 420 files with oldest-mtime cull.
- `sealJson` / `sealTo` seal the payload to the owner + Kami pubkey before upload.
- `snapshot.js` `buildSnapshot` already assembles the full combat/physics/bots/kami
  state the diagnostic needs.
- The rAF gameplay loop (`loop.js` → `arenaRuntime.update(dt, frame)`) is where
  all per-frame work happens; the title-screen `_shellTick` is gated on
  `!isPlaying()` so it does NOT run during gameplay and cannot host this.

## Decision
Add a 1Hz auto-capture diagnostic: a rolling ring of sealed (frame + snapshot)
records captured every second while the owner plays, so the run-up to any incident
is on tape including the phantoms.

### 1. Client state machine — `src/engine/kami/kamiAutoCapture.js` (pure, new)
A pure, injectable state machine with NO DOM / THREE imports (testable in node):

```
createAutoCapture({ intervalMs=1000, ringCap=120 }) → { tick, captureNow, report, reset }
```

- `tick(nowMs, ctx)` — called from the in-arena rAF loop. Returns a capture
  REQUEST `{frameId, ts, snapshot}` or `null`. Emits a request only when ALL hold:
  - `ctx.isOwner` (admin pubkey present) — non-owners never capture.
  - `ctx.isPlaying` — title/pause screens do not capture.
  - `!ctx.inflight` — backpressure: if the previous capture's seal+POST is still
    in flight, skip this tick (do not retry missed frames).
  - `nowMs - lastCapturedAt >= intervalMs` — the 1Hz throttle.
- `markUploaded(frameId)` / `markFailed(frameId, err)` — the async seal+POST
  resolves through these; `inflight` clears on either. A failure resets state but
  does NOT pause future captures (transient relay failure should retry next tick).
- `report()` — `{ enabled, lastFrameId, lastCapturedAt, lastUploadOkAt, inflight,
  lastError, captured, uploaded, failed }` — surfaced into the manual ema
  snapshot (via `snapshot.js` `buildAutoCaptureReport`) so a hung ema points at the
  nearby auto-capture frames.
- `captureNow(nowMs, ctx)` — forces a capture ignoring the interval (for a manual
  "mark this moment" trigger). Still respects owner + playing + !inflight.
- `intervalMs` is a named constant so it can be raised later if 1Hz misses
  sub-second phantoms.

### 2. Integration — `arenaRuntime.js` (the in-arena rAF loop)
- Instantiate `createAutoCapture()` once per arena boot.
- In `update(dt, frame)`, after the existing per-frame ticks, call
  `const req = _autoCap.tick(nowMs, ctx)` where `ctx` is built from already-available
  handles (`isPlaying()`, `state.nostrPubkey` → owner, `inflight` from the state
  machine). When `req` is non-null:
  1. `requestFrameGrab((url) => { … })` — the same-tick canvas grab.
  2. On the frame callback, assemble the batch `{ id: frameId, ema: <sealed
     snapshot JSON>, shot: { env: <sealed jpeg bytes>, bytes } }` reusing the
     existing `sealJson` / `sealTo` / `dataUrlToBytes` helpers, then POST to the
     new `/mp/kami/autocap` route (NOT `/mp/kami/ema` — see below). Resolve
     `markUploaded` / `markFailed`.
- The seal+POST is fire-and-forget; the loop never `await`s it. `inflight` guards
  against re-entry.

### 3. Server store + route — `server/kami/kamiAutoStore.js` (pure, new) + `arena-ws.js`
- A SEPARATE ring directory `/var/lib/torii-quest/kami/autocap/` with its own cap
  (120 files). It does NOT touch `ema.jsonl` (append-only forever) and does NOT
  share the manual `shots/` cap (420), so auto-capture cannot evict real manual ema
  screenshots.
- Store shape mirrors `kamiStore`: `writeAuto(id, envJson)` + `cullAuto()` to the
  `autocap` ring.
- New route `POST /mp/kami/autocap` in `arena-ws.js`:
  - Admin-gated via the SAME `adminFromRequest` (bearer session token — no
    per-second NIP-07 signing; the session token is the consent the owner
    already granted at login).
  - Body-capped (`KAMI_BODY_CAP` reused; a 1-frame JPEG+snapshot is ~200-400KB,
    well under the cap).
  - Shape `{ v:1, batch:[{id, ema, shot?}] }` — the SAME shape as `/mp/kami/ema`
    so `validateKamiBatch` is reused; only the store + cap differ.
  - Stores sealed ciphertext only (never reads it).

### 4. Retrieval — `tools/kami-autocap-dump.mjs` (new CLI)
A node CLI the operator runs from the sandbox (after pulling the autocap ring from
the VPS) that:
- Reads each sealed `autocap/<id>.bin` + the `autocap.jsonl` index.
- Decrypts with `KAMI_PRIV` (the existing kami-priv.hex) via `openJson` /
  `openSealed`.
- Writes `frames/frame-<n>.jpg` + a `timeline.jsonl` (one line per frame:
  frameId, ts, player pos, usedAimRay, bot positions, kami state).
- Optionally stitches the JPEGs into an MP4 via the pre-installed `ffmpeg` when
  `--video` is passed.

### 5. Snapshot surface
`snapshot.js` gains `buildAutoCaptureReport(p)` → `{ enabled, lastFrameId,
lastCapturedAt, lastUploadOkAt, inflight, lastError }`, wired into
`buildSnapshot` so a manual ema hung at an incident points at the nearby
auto-capture frames (by timestamp).

## Performance
- 1 frame grab + 1 seal + 1 POST per second, max. ~200-400KB per frame.
- `inflight` backpressure skips the next tick if the previous upload is still
  resolving — no queue buildup under slow networks.
- No `MediaRecorder`, no browser video stream, no `preserveDrawingBuffer`.
- The ring cap (120) bounds disk to ~120 × ~400KB ≈ 48MB worst case.

## Consequences
- Owner-only: a non-admin session never captures (no privacy leak).
- Sealed end-to-end (same as manual ema) — the server holds ciphertext only.
- Separate ring — auto-capture cannot starve manual ema storage.
- 1Hz may still miss sub-second phantoms; `intervalMs` is a constant so it can be
  raised to 2-4Hz later if needed (the `inflight` guard prevents runaway).
- No new timers (rAF only, per the project hard constraint).
- No gameplay change — diagnostic capture only.

## Files
- `src/engine/kami/kamiAutoCapture.js` (new, pure)
- `src/engine/debug/snapshot.js` (add `buildAutoCaptureReport` + wire into `buildSnapshot`)
- `src/arenaRuntime.js` (instantiate + tick + seal+POST)
- `server/kami/kamiAutoStore.js` (new, pure)
- `server/arena-ws.js` (new `POST /mp/kami/autocap` route)
- `tools/kami-autocap-dump.mjs` (new CLI)
- `tests/kami/kami-auto-capture.test.js` (new — state machine)
- `tests/kami/kami-auto-store.test.js` (new — ring store)
- `tests/kami-autocap-route.test.js` (new — admin gate + reuse validateKamiBatch)
- Version bump to `v0.2.678-alpha`
