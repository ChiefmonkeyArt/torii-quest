// state.js — single source of truth. No state lives elsewhere.
import { ENTRY_SATS, PLAYER_HP, MAX_AMMO } from './config.js';
import { emit, EV } from './events.js';

export const PHASE = Object.freeze({
  TITLE: 'title', PLAYING: 'playing',
  DEAD: 'dead', PAUSED: 'paused', GAMEOVER: 'gameover',
});
// GAMEOVER is the terminal end-of-run phase. v0.2.133 wired the inbound edge:
// PLAYING/DEAD → GAMEOVER via GAME_EVENT.END (see TRANSITIONS + endRun()).
// GAMEOVER itself has no outgoing edge yet (a future GAMEOVER → TITLE exit will
// land with the end-of-run screen). Behaviour-preserving: no live call site fires
// END today, so the endless die→respawn flow is unchanged.

export const state = {
  phase:      PHASE.TITLE,
  hp:         PLAYER_HP,
  sats:       ENTRY_SATS,
  kills:      0,
  deaths:     0,
  hits:       0,
  ammo:       MAX_AMMO,
  reloading:  false,
  reloadTimer:0,
  shootCd:    0,
  respawnTimer:0,
  pointerLocked: false,
  // Dev/debug free-fly camera intent. Toggled on the title screen (DOM only) and
  // read at ENTER to enable ToriiDebug.fly once the arena boots; also mirrors the
  // live in-game fly state so the title toggle reflects reality after returning Home.
  flyMode: false,
  // Player-ownership boundary (v0.2.291): Torii Quest seats exactly ONE local
  // player. nostrPubkey/Name/Profile/Avatar identify whoever currently controls
  // this client — anon by default, or a verified npub once a NIP-07 login OR a
  // crypto-verified P2 arrival (engine/gateway/handoffArrival.js → main.js) seats
  // one. All gameplay state above (hp/ammo/phase/kills…) belongs to that single
  // local player; there is no per-remote-player state in this client. (The earlier
  // unused `remotePlayers: new Map()` stub was removed here — it was never read or
  // written, so it only blurred this single-local-player ownership boundary. A real
  // networked-player roster would be a separate, deliberately-scoped feature.)
  nostrPubkey:  null,
  nostrName:    'ANON',
  nostrProfile: null,
  nostrAvatar:   null,
};

export function resetRun() {
  state.hp      = PLAYER_HP;
  state.sats    = ENTRY_SATS;
  state.kills   = 0;
  state.hits    = 0;
  state.ammo    = MAX_AMMO;
  state.reloading  = false;
  state.reloadTimer = 0;
  state.shootCd = 0;
}

// ── Explicit game-state machine (v0.2.115, first slice) ────────────────────
// Groundwork for TODO #8. `state.phase` is unchanged; this adds ONE place that
// describes the legal flow so call sites stop hand-rolling `if (phase !== X)`
// guards. Behaviour is identical: the table below mirrors the exact guards the
// call sites used before it existed.

// Canonical transition events — the phase only ever changes via one of these.
export const GAME_EVENT = Object.freeze({
  ENTER:   'enter',    // TITLE   → PLAYING  (Enter Arena)
  PAUSE:   'pause',    // PLAYING → PAUSED   (ESC / pointer-lock loss)
  RESUME:  'resume',   // PAUSED  → PLAYING  (ESC / Resume button)
  HOME:    'home',     // PAUSED  → TITLE    (Home button)
  DIE:     'die',      // PLAYING → DEAD     (hp <= 0)
  RESPAWN: 'respawn',  // DEAD    → PLAYING  (respawn timer elapsed)
  END:     'end',      // PLAYING/DEAD → GAMEOVER (end of run; no respawn)
});

// phase → (event → nextPhase). An event not listed for the current phase is an
// illegal transition and is rejected (phase unchanged).
const TRANSITIONS = Object.freeze({
  [PHASE.TITLE]:    { [GAME_EVENT.ENTER]:   PHASE.PLAYING },
  [PHASE.PLAYING]:  { [GAME_EVENT.PAUSE]:   PHASE.PAUSED,  [GAME_EVENT.DIE]: PHASE.DEAD, [GAME_EVENT.END]: PHASE.GAMEOVER },
  [PHASE.PAUSED]:   { [GAME_EVENT.RESUME]:  PHASE.PLAYING, [GAME_EVENT.HOME]: PHASE.TITLE },
  [PHASE.DEAD]:     { [GAME_EVENT.RESPAWN]: PHASE.PLAYING, [GAME_EVENT.END]: PHASE.GAMEOVER },
  [PHASE.GAMEOVER]: {},
});

// nextPhase(event) → the phase this event leads to from the CURRENT phase, or
// null if it is not legal right now. Pure; never mutates.
export function nextPhase(event) {
  const row = TRANSITIONS[state.phase];
  return (row && row[event]) || null;
}

// canTransition(event) → would this event be accepted from the current phase?
export function canTransition(event) { return nextPhase(event) !== null; }

// transition(event) → apply the transition if legal. Returns true if the phase
// changed, false (no change) otherwise — so callers can early-return and skip
// their side effects exactly as the old `if (phase !== X) return;` guards did.
// On a real change it publishes EV.PHASE_CHANGE so other modules can react to
// the phase flow without polling. Transitions are discrete (enter/pause/resume/
// die/respawn), never per-frame, so the small payload object is not a hot-path
// allocation. There are no subscribers yet, so this is behaviour-preserving.
export function transition(event) {
  const next = nextPhase(event);
  if (!next) return false;
  const from = state.phase;
  state.phase = next;
  emit(EV.PHASE_CHANGE, { from, to: next, event });
  return true;
}

// endRun() → fire GAME_EVENT.END (PLAYING/DEAD → GAMEOVER). The named, testable
// entry point for an end-of-run/game-over flow. Behaviour-preserving — no live
// call site fires it yet, so the endless die→respawn loop is unchanged; it exists
// so a future end-of-run screen has one canonical place to terminate a run.
export function endRun() { return transition(GAME_EVENT.END); }

// ── Weapon-state predicates (v0.2.130) ─────────────────────────────────────
// Pure gates for the firing/reload flow, extracted from player.js so the rules
// live in one place and are unit-testable. They take a state-like object (the
// live `state` by default) and read only the weapon fields, so behaviour is
// identical to the inline guards they replace:
//   shoot()       was: shootCd > 0 || reloading || ammo <= 0  → return
//   startReload() was: reloading || ammo === MAX_AMMO          → return
// (ammo is capped at MAX_AMMO, so `ammo < MAX_AMMO` matches `ammo !== MAX_AMMO`.)
export function canShoot(s = state)  { return s.shootCd <= 0 && !s.reloading && s.ammo > 0; }
export function canReload(s = state) { return !s.reloading && s.ammo < MAX_AMMO; }

// isReloading — the reload sub-state predicate (PLAYING-only sub-flow). Reads
// only the `reloading` flag so the "is a reload in progress" question lives with
// the other weapon-state gates instead of being hand-rolled as `state.reloading`
// at each read site (player tick, viewmodel pose, reload anim trigger).
export const isReloading = (s = state) => s.reloading;

// tickReload — advance the reload timer by dt; the ONE place the reload sub-state
// completes (v0.2.132, ARS-4 fold). Mirrors the old inline block in player.js:
// when the timer elapses, clear the flag and refill the mag. Returns true ONLY on
// the frame the reload finishes, so the caller emits its HUD update exactly as
// before; returns false (no-op) when not reloading or still counting down. Pure
// w.r.t. modules — mutates only the passed state object (live `state` default).
export function tickReload(dt, s = state) {
  if (!s.reloading) return false;
  s.reloadTimer -= dt;
  if (s.reloadTimer > 0) return false;
  s.reloading = false;
  s.ammo = MAX_AMMO;
  return true;
}

// ── Phase predicates ───────────────────────────────────────────────────────
export const isTitle    = () => state.phase === PHASE.TITLE;
export const isPlaying  = () => state.phase === PHASE.PLAYING;
export const isPaused   = () => state.phase === PHASE.PAUSED;
export const isDead     = () => state.phase === PHASE.DEAD;
export const isGameover = () => state.phase === PHASE.GAMEOVER;
// "Live" = the world ticks/renders with the player in it: PLAYING or the brief
// DEAD death-cam before respawn. Used by the render gate.
export const isLive     = () => state.phase === PHASE.PLAYING || state.phase === PHASE.DEAD;

// ── Pointer-lock / engagement predicates (v0.2.131, ARS-4 fold slice) ───────
// Folds the `pointerLocked` boolean into pure, testable phase predicates so the
// "is the player actively in control" question lives in one place instead of
// being hand-rolled as `isPlaying() && (!)state.pointerLocked` at call sites.
// Pure: takes a state-like object (live `state` by default), reads only phase +
// pointerLocked, so it is behaviour-identical to the inline guards it replaces.
//   isEngaged       — PLAYING with the cursor captured: input is live.
//   needsPointerLock— PLAYING but cursor free: a canvas click should re-acquire
//                     (was: `isPlaying() && !state.pointerLocked` in main.js).
export const isEngaged        = (s = state) => s.phase === PHASE.PLAYING && s.pointerLocked;
export const needsPointerLock = (s = state) => s.phase === PHASE.PLAYING && !s.pointerLocked;
