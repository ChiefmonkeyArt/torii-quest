// tests/state.test.js — locks down the game-phase state machine (src/state.js):
// legal transitions, illegal transitions are rejected, and the predicates.
// `transition()` mutates the module-level `state` singleton, so each test
// resets `state.phase` first (the singleton is the documented seam).
import { describe, it, expect, beforeEach } from 'vitest';
import {
  PHASE, GAME_EVENT, state,
  nextPhase, canTransition, transition, endRun,
  isTitle, isPlaying, isPaused, isDead, isGameover, isLive,
  isEngaged, needsPointerLock,
  canShoot, canReload, isReloading, tickReload,
} from '../src/state.js';
import { MAX_AMMO } from '../src/config.js';

function setPhase(p) { state.phase = p; }

beforeEach(() => { setPhase(PHASE.TITLE); });

describe('nextPhase / canTransition (pure reads)', () => {
  it('TITLE + ENTER → PLAYING', () => {
    setPhase(PHASE.TITLE);
    expect(nextPhase(GAME_EVENT.ENTER)).toBe(PHASE.PLAYING);
    expect(canTransition(GAME_EVENT.ENTER)).toBe(true);
  });
  it('PLAYING + PAUSE → PAUSED, PLAYING + DIE → DEAD', () => {
    setPhase(PHASE.PLAYING);
    expect(nextPhase(GAME_EVENT.PAUSE)).toBe(PHASE.PAUSED);
    expect(nextPhase(GAME_EVENT.DIE)).toBe(PHASE.DEAD);
  });
  it('PAUSED + RESUME → PLAYING, PAUSED + HOME → TITLE', () => {
    setPhase(PHASE.PAUSED);
    expect(nextPhase(GAME_EVENT.RESUME)).toBe(PHASE.PLAYING);
    expect(nextPhase(GAME_EVENT.HOME)).toBe(PHASE.TITLE);
  });
  it('DEAD + RESPAWN → PLAYING', () => {
    setPhase(PHASE.DEAD);
    expect(nextPhase(GAME_EVENT.RESPAWN)).toBe(PHASE.PLAYING);
  });
  it('rejects illegal events for the current phase', () => {
    setPhase(PHASE.TITLE);
    expect(nextPhase(GAME_EVENT.PAUSE)).toBeNull();
    expect(canTransition(GAME_EVENT.DIE)).toBe(false);
    setPhase(PHASE.PLAYING);
    expect(nextPhase(GAME_EVENT.ENTER)).toBeNull();
    expect(nextPhase(GAME_EVENT.RESPAWN)).toBeNull();
  });
  it('PLAYING + END → GAMEOVER, DEAD + END → GAMEOVER (v0.2.133)', () => {
    setPhase(PHASE.PLAYING);
    expect(nextPhase(GAME_EVENT.END)).toBe(PHASE.GAMEOVER);
    setPhase(PHASE.DEAD);
    expect(nextPhase(GAME_EVENT.END)).toBe(PHASE.GAMEOVER);
  });
  it('END is illegal from TITLE and PAUSED (v0.2.133)', () => {
    setPhase(PHASE.TITLE);
    expect(nextPhase(GAME_EVENT.END)).toBeNull();
    setPhase(PHASE.PAUSED);
    expect(nextPhase(GAME_EVENT.END)).toBeNull();
  });
  it('GAMEOVER is a terminal phase with no outgoing edges', () => {
    setPhase(PHASE.GAMEOVER);
    for (const ev of Object.values(GAME_EVENT)) {
      expect(nextPhase(ev)).toBeNull();
    }
  });
  it('returns null for an unknown event name', () => {
    setPhase(PHASE.TITLE);
    expect(nextPhase('not-an-event')).toBeNull();
  });
});

describe('transition (mutating)', () => {
  it('applies a legal transition and returns true', () => {
    setPhase(PHASE.TITLE);
    expect(transition(GAME_EVENT.ENTER)).toBe(true);
    expect(state.phase).toBe(PHASE.PLAYING);
  });
  it('does NOT mutate phase and returns false on an illegal transition', () => {
    setPhase(PHASE.TITLE);
    expect(transition(GAME_EVENT.PAUSE)).toBe(false);
    expect(state.phase).toBe(PHASE.TITLE);
  });
  it('runs a full legal lifecycle TITLE→PLAYING→PAUSED→PLAYING→DEAD→PLAYING', () => {
    setPhase(PHASE.TITLE);
    expect(transition(GAME_EVENT.ENTER)).toBe(true);   // PLAYING
    expect(transition(GAME_EVENT.PAUSE)).toBe(true);   // PAUSED
    expect(transition(GAME_EVENT.RESUME)).toBe(true);  // PLAYING
    expect(transition(GAME_EVENT.DIE)).toBe(true);     // DEAD
    expect(transition(GAME_EVENT.RESPAWN)).toBe(true); // PLAYING
    expect(state.phase).toBe(PHASE.PLAYING);
  });
});

describe('endRun (GAMEOVER edge, v0.2.133)', () => {
  it('ends a run from PLAYING → GAMEOVER', () => {
    setPhase(PHASE.PLAYING);
    expect(endRun()).toBe(true);
    expect(state.phase).toBe(PHASE.GAMEOVER);
  });
  it('ends a run from DEAD → GAMEOVER', () => {
    setPhase(PHASE.DEAD);
    expect(endRun()).toBe(true);
    expect(state.phase).toBe(PHASE.GAMEOVER);
  });
  it('is a no-op from TITLE / PAUSED / GAMEOVER (returns false, phase unchanged)', () => {
    for (const p of [PHASE.TITLE, PHASE.PAUSED, PHASE.GAMEOVER]) {
      setPhase(p);
      expect(endRun()).toBe(false);
      expect(state.phase).toBe(p);
    }
  });
});

describe('phase predicates', () => {
  it('isTitle / isPlaying / isPaused / isDead / isGameover are exclusive', () => {
    setPhase(PHASE.TITLE);    expect([isTitle(), isPlaying(), isPaused(), isDead(), isGameover()]).toEqual([true, false, false, false, false]);
    setPhase(PHASE.PLAYING);  expect([isTitle(), isPlaying(), isPaused(), isDead(), isGameover()]).toEqual([false, true, false, false, false]);
    setPhase(PHASE.PAUSED);   expect([isTitle(), isPlaying(), isPaused(), isDead(), isGameover()]).toEqual([false, false, true, false, false]);
    setPhase(PHASE.DEAD);     expect([isTitle(), isPlaying(), isPaused(), isDead(), isGameover()]).toEqual([false, false, false, true, false]);
    setPhase(PHASE.GAMEOVER); expect([isTitle(), isPlaying(), isPaused(), isDead(), isGameover()]).toEqual([false, false, false, false, true]);
  });
  it('isLive is true while PLAYING or DEAD', () => {
    setPhase(PHASE.PLAYING); expect(isLive()).toBe(true);
    setPhase(PHASE.DEAD);    expect(isLive()).toBe(true);
    setPhase(PHASE.TITLE);   expect(isLive()).toBe(false);
    setPhase(PHASE.PAUSED);  expect(isLive()).toBe(false);
  });
});

describe('pointer-lock predicates (pure, take a state-like object)', () => {
  // isEngaged: PLAYING && pointerLocked ; needsPointerLock: PLAYING && !pointerLocked
  it('isEngaged true only when PLAYING with the cursor captured', () => {
    expect(isEngaged({ phase: PHASE.PLAYING, pointerLocked: true })).toBe(true);
    expect(isEngaged({ phase: PHASE.PLAYING, pointerLocked: false })).toBe(false);
    expect(isEngaged({ phase: PHASE.PAUSED,  pointerLocked: true })).toBe(false);
    expect(isEngaged({ phase: PHASE.TITLE,   pointerLocked: true })).toBe(false);
  });
  it('needsPointerLock true only when PLAYING with the cursor free', () => {
    expect(needsPointerLock({ phase: PHASE.PLAYING, pointerLocked: false })).toBe(true);
    expect(needsPointerLock({ phase: PHASE.PLAYING, pointerLocked: true })).toBe(false);
    expect(needsPointerLock({ phase: PHASE.PAUSED,  pointerLocked: false })).toBe(false);
    expect(needsPointerLock({ phase: PHASE.TITLE,   pointerLocked: false })).toBe(false);
  });
  it('isEngaged and needsPointerLock are mutually exclusive and never both true', () => {
    for (const phase of Object.values(PHASE)) {
      for (const pointerLocked of [true, false]) {
        const s = { phase, pointerLocked };
        expect(isEngaged(s) && needsPointerLock(s)).toBe(false);
      }
    }
  });
  it('default to the live state singleton when no argument is passed', () => {
    setPhase(PHASE.PLAYING); state.pointerLocked = true;
    expect(isEngaged()).toBe(true);
    expect(needsPointerLock()).toBe(false);
    state.pointerLocked = false;
    expect(isEngaged()).toBe(false);
    expect(needsPointerLock()).toBe(true);
  });
});

describe('weapon-state predicates (pure, take a state-like object)', () => {
  // canShoot: shootCd <= 0 && !reloading && ammo > 0
  it('canShoot true only when cooled down, not reloading, and ammo remains', () => {
    expect(canShoot({ shootCd: 0,   reloading: false, ammo: 5 })).toBe(true);
    expect(canShoot({ shootCd: 0.1, reloading: false, ammo: 5 })).toBe(false); // on cooldown
    expect(canShoot({ shootCd: 0,   reloading: true,  ammo: 5 })).toBe(false); // reloading
    expect(canShoot({ shootCd: 0,   reloading: false, ammo: 0 })).toBe(false); // empty
  });
  // canReload: !reloading && ammo < MAX_AMMO
  it('canReload true only when not already reloading and the mag is not full', () => {
    expect(canReload({ reloading: false, ammo: 0 })).toBe(true);
    expect(canReload({ reloading: false, ammo: MAX_AMMO - 1 })).toBe(true);
    expect(canReload({ reloading: false, ammo: MAX_AMMO })).toBe(false); // full
    expect(canReload({ reloading: true,  ammo: 0 })).toBe(false);        // already reloading
  });
  it('default to the live state singleton when no argument is passed', () => {
    state.shootCd = 0; state.reloading = false; state.ammo = MAX_AMMO;
    expect(canShoot()).toBe(true);   // cooled, loaded, ammo present
    expect(canReload()).toBe(false); // mag full
    state.ammo = 0;
    expect(canShoot()).toBe(false);  // empty
    expect(canReload()).toBe(true);  // not full
  });
});

describe('reload sub-state fold (isReloading / tickReload, ARS-4)', () => {
  it('isReloading mirrors the reloading flag', () => {
    expect(isReloading({ reloading: true })).toBe(true);
    expect(isReloading({ reloading: false })).toBe(false);
  });
  it('tickReload is a no-op when not reloading', () => {
    const s = { reloading: false, reloadTimer: 0, ammo: 0 };
    expect(tickReload(0.1, s)).toBe(false);
    expect(s.ammo).toBe(0);            // not refilled
    expect(s.reloading).toBe(false);
  });
  it('tickReload counts the timer down without finishing early', () => {
    const s = { reloading: true, reloadTimer: 1.0, ammo: 0 };
    expect(tickReload(0.4, s)).toBe(false);  // 1.0 → 0.6, still going
    expect(s.reloadTimer).toBeCloseTo(0.6, 6);
    expect(s.reloading).toBe(true);
    expect(s.ammo).toBe(0);                  // mag not refilled mid-reload
  });
  it('tickReload completes once: clears the flag, refills the mag, returns true', () => {
    const s = { reloading: true, reloadTimer: 0.3, ammo: 0 };
    expect(tickReload(0.3, s)).toBe(true);   // hits exactly 0 → done
    expect(s.reloading).toBe(false);
    expect(s.ammo).toBe(MAX_AMMO);
    // A subsequent tick is a clean no-op (reload already finished).
    expect(tickReload(0.1, s)).toBe(false);
  });
  it('tickReload defaults to the live state singleton', () => {
    state.reloading = true; state.reloadTimer = 0.05; state.ammo = 0;
    expect(tickReload(0.1)).toBe(true);      // overshoot still completes
    expect(state.reloading).toBe(false);
    expect(state.ammo).toBe(MAX_AMMO);
  });
});
