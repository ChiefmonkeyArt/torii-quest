# ADR-0100: Recording-ring toggle (owner-controlled pause for the 1Hz auto-capture)

- **Status:** Accepted
- **Version:** v0.2.744-alpha
- **Supersedes / relates to:** ADR-0055 (Kami auto-capture ring — the always-on 1Hz sealed frame + snapshot capture), ADR-0099 (Kami-mode dev menu shell — the surface this toggle registers into).

## Context

ADR-0055 introduced a 1Hz auto-capture ring that seals a frame + snapshot to the owner + Kami pubkey while the owner is playing. It has been running unconditionally since — the right default (a hung ema can point back at recent frames), but the owner has no way to pause it without editing the code:

- During a live demo, a stream, or on a metered network, the continuous upload is unwelcome.
- The on-screen recording indicator (`recIndicator.js`) reflects "currently capturing" but can't reflect a deliberate pause because there was no pause path.
- The prior ship (ADR-0099) added a discoverable owner-only menu — but that menu had exactly one row (the sticker A/B). This ADR earns the shell its second row and validates it as the correct surface for future toggles.

## Decision

Introduce a single **boolean recording-ring gate** and register a dev-menu row against it:

1. `src/engine/dev/recordingRingGate.js` — pure module. `isRecordingRingEnabled()` / `setRecordingRingEnabled(on)`. Default **ON** so no one who never touches the menu sees a behavioural change. No timers, no DOM, no persistence — a page reload resets to the default; the ring is a diagnostic, not a durable setting.

2. `src/arenaRuntime.js` — three tiny wiring changes:
   - `_driveAutoCapture()` short-circuits with `if (!isRecordingRingEnabled()) return;` **before** `_autoCap.tick()`. When the ring is off, the state machine never emits a request, the frame grab never runs, and no upload leaves the client.
   - `recIndicator.isActive` predicate observes the gate (`isPlaying() && isRecordingRingEnabled()`), so the on-screen dot goes dark exactly when captures stop — the surface and the underlying path stay in perfect sync.
   - `registerDevToggle({ id: 'recording-ring', get: isRecordingRingEnabled, set: setRecordingRingEnabled })` on the ADR-0099 dev-menu shell.

3. `src/main.js` — `ToriiDebug.recording.state()` / `.enabled(on)` console mirror. Same underlying flag as the dev-menu row (single source of truth). Console-first users keep their muscle memory.

## Consequences

**Positive:**

- Owner can pause the 1Hz ring for the duration of a demo without a code edit or an app restart.
- The recording indicator dot mirrors reality — never falsely reports "recording" while the ring is paused.
- Zero cost when the gate is on the default (`true`): the early-return check is one function call and one boolean check per frame.
- Two toggles on the ADR-0099 shell demonstrate the additive model works. Future runtime toggles (fly-cam, hitbox debug overlay, etc.) can register with one line.
- The pure module + wiring locks let a stray refactor break the tests loudly, not silently.

**Negative / open edges:**

- No persistence — reloading the page or entering the arena from Title resets to ON. That's on purpose (the ring is a diagnostic, not a stored preference), but if this becomes annoying we can flip persistence on with a `localStorage` line later.
- The gate lives inside the client; a paused ring says nothing to the server. Correct: nothing to say — the ring writes to Blossom, not to the arena WS.
- Kami-active users on other nodes never see the recording-ring toggle for this owner — the whole dev menu is owner-only. Also correct: the recording ring is the owner's diagnostic capture, so only the owner should be able to pause it.

## Test coverage

`tests/adr-0100-recording-ring-toggle.test.js` — 11 tests covering:

- Pure gate module: default ON, flip, boolean coercion, setter return value, reset helper.
- Runtime wiring locks: the exact import line, the early-return position **before** `_autoCap.tick()`, the recIndicator conjunction, the dev-menu row registration shape (single source of truth verified by locking on the accessor names, not a separate flag).
- Console mirror locks: same import in `main.js`, `state()` + `enabled()` shape on `ToriiDebug.recording`.

## Not in this ADR

- No per-toggle persistence layer. If storage is wanted, a small `localStorage`-backed factory can wrap `createRecordingRingGate()` later — it wasn't wanted in scope here.
- No non-boolean toggles on the dev menu (numeric sliders, enum selectors). That waits for a real use case.
- No server-side capture disable — the recording ring is a purely client-side upload, and the pause happens in the client where the sealing happens.

## References

- `src/engine/dev/recordingRingGate.js` — the pure gate
- `src/engine/kami/kamiAutoCapture.js` — the 1Hz state machine (ADR-0055) it gates
- `src/engine/render/recIndicator.js` — the on-screen recording dot
- `src/engine/dev/devMenu.js` — the ADR-0099 shell this toggle rides
- `tests/adr-0100-recording-ring-toggle.test.js`
