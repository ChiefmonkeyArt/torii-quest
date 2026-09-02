// engine/state/clientSuspended.js \u2014 v0.2.742-alpha (ADR-0098)
//
// Tiny pure suspension flag. When the local player leaves the arena via Home,
// the render loop halts and the AudioContext is suspended \u2014 but a bot SHOT
// event could still race in between the flag flip and the socket disconnect.
// This is the belt-and-braces guard: audio emitters and any effect-fire path
// consult isClientSuspended() and short-circuit rather than trusting purely on
// the loop halt / AudioContext suspension.
//
// No DOM, no imports. Node-safe for unit tests. Owned by the arena runtime
// which flips it around leaveToTitle / resumeFromTitle.
let _suspended = false;

export function isClientSuspended() { return _suspended; }
export function setClientSuspended(v) { _suspended = !!v; }
