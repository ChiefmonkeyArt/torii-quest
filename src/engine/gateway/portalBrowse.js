// engine/gateway/portalBrowse.js — the BROWSE-LOOP state machine for the torii gate.
//
// Before this slice a directory click went STRAIGHT to travelToWorld (in-place world
// swap). That left no way to "look at world A, look at world B, then commit" — the
// two-node playtest asked for exactly that. The UX is click-to-SEE only:
//
//   click a name → peer through the gate (mirror opens, world stays)
//   click another → peer at a DIFFERENT world (mirror switches, world stays)
//   click 入 (enter) → walk through into the currently-peered world (the only swap)
//   click ✕ → step away from the gate and resume play / shop (cancel, no swap)
//
// There is NO Esc-to-browse step: switching is just clicking the next name, and backing
// away is just the ✕ on the panel. Esc still closes the panel (the ✕ equivalent).
//
// This is a pure, node-testable state machine (no DOM, no THREE, no fetch). It owns the
// phases and answers the one question the rest of the stack must not get wrong: does
// THIS action swap the world? Two actions must NEVER swap (peek, cancel); only one may
// (commit), and only while a peek is open.
//
// States + transitions:
//
//   directory  ── peek ──►  peeking     (mirror opens, no swap)
//   peeking    ── peek ──►  peeking     (switch to a different world, no swap)
//   peeking    ── cancel ─► directory   (mirror tears down, no swap)
//   peeking    ── commit ─► travelling  (the ONLY swap)
//   travelling ── * ──►     travelling  (commit is one-way; nothing un-swaps a landed world)
//
//   createPortalBrowse() → { state(), step(action), snapshot() }
//     state():    'directory' | 'peeking' | 'travelling'
//     step(a):    { state, swap, changed }   (swap is ONLY true on the commit transition)
//     snapshot(): { state, peekId, swaps, cancels, peeks }

export const BROWSE_STATE = Object.freeze({
  DIRECTORY: 'directory',
  PEEKING: 'peeking',
  TRAVELLING: 'travelling',
});

export const BROWSE_ACTION = Object.freeze({
  PEEK: 'peek',
  COMMIT: 'commit',
  CANCEL: 'cancel',
});

export function createPortalBrowse() {
  let state = BROWSE_STATE.DIRECTORY;
  let peekId = null;
  let peeks = 0;
  let cancels = 0;
  let swaps = 0;

  function snapshot() {
    return { state, peekId, peeks, cancels, swaps };
  }

  // step(action) → { state, swap, changed }. The authoritative answer to
  // "should the world actually swap right now?". Only commit-from-peeking says yes.
  function step(action) {
    let swap = false;
    let changed = true;

    switch (action) {
      case BROWSE_ACTION.PEEK:
        // Open (or switch) the mirror. Never swaps — the player is only LOOKING.
        // Once committed (travelling) the browse session is over: a peek is refused
        // so a landed world can never be silently re-mirrored. A fresh gate door
        // creates a fresh machine.
        if (state === BROWSE_STATE.TRAVELLING) { changed = false; break; }
        peeks += 1;
        state = BROWSE_STATE.PEEKING;
        peekId = `peek-${peeks}`;
        break;

      case BROWSE_ACTION.CANCEL:
        // Back away to the directory. Never swaps. A cancel while not peeking is a no-op.
        if (state !== BROWSE_STATE.PEEKING) { changed = false; break; }
        cancels += 1;
        state = BROWSE_STATE.DIRECTORY;
        peekId = null;
        break;

      case BROWSE_ACTION.COMMIT:
        // Commit is the ONLY swap, and only from an open peek. From the directory it is
        // refused (nothing to commit); after travelling it is a no-op (one-way).
        if (state !== BROWSE_STATE.PEEKING) { changed = false; break; }
        swaps += 1;
        swap = true;
        state = BROWSE_STATE.TRAVELLING;
        peekId = null;
        break;

      default:
        changed = false;
        break;
    }

    return { state, swap, changed };
  }

  // reset() — a fresh gate visit starts a fresh browse. Called when the gateway
  // screen reopens (F at the gate): a new session may peek/commit again even after a
  // prior commit landed the player in a different world (the machine is one session
  // per gate visit, not per arena lifetime).
  function reset() {
    state = BROWSE_STATE.DIRECTORY;
    peekId = null;
    peeks = 0;
    cancels = 0;
    swaps = 0;
  }

  return { state: () => state, step, reset, snapshot };
}