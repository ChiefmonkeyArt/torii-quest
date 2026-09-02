// engine/dev/recordingRingGate.js — pure boolean gate for ADR-0055's 1Hz
// auto-capture ring.
//
// ADR-0100 (v0.2.744-alpha): the auto-capture ring runs unconditionally while
// the owner is playing, sealing a frame + snapshot to owner+Kami pubkey every
// second (ADR-0055). That's the right default — a hung ema can point back at
// recent frames — but the owner may want to pause it (e.g. during a demo, or
// to save upload bandwidth on a shared network).
//
// Design:
//  • Default ON to match current behaviour. A player who never opens the dev
//    menu sees no change.
//  • Single flag. Read via isRecordingRingEnabled(); write via
//    setRecordingRingEnabled(on). Cheap.
//  • No timers, no DOM, no THREE — this module is pure so it stays trivially
//    test-covered. Persistence isn't required (a page reload resets to the
//    default; the ring is a diagnostic, not a durable setting).
//  • The Kami dev menu row (registered in arenaRuntime.js) and any console
//    incantation on ToriiDebug.recording.enabled(...) both flip THIS flag —
//    single source of truth.
//
// This gate is layered ABOVE the existing owner + playing gates in
// kamiAutoCapture.tick(); if any of them refuse, no capture request is emitted
// and the recIndicator dot goes dark.

let _enabled = true;

// isRecordingRingEnabled() — read the current flag. Cheap; safe on any thread.
export function isRecordingRingEnabled() { return _enabled; }

// setRecordingRingEnabled(on) — mutate the flag. Coerces to boolean. Returns
// the new value for chaining.
export function setRecordingRingEnabled(on) {
  _enabled = !!on;
  return _enabled;
}

// __resetRecordingRingGateForTests() — tests only. Never called at runtime.
export function __resetRecordingRingGateForTests() { _enabled = true; }
