// tests/state.test.js — locks down the game-phase state machine (src/state.js):
// legal transitions, illegal transitions are rejected, and the predicates.
// `transition()` mutates the module-level `state` singleton, so each test
// resets `state.phase` first (the singleton is the documented seam).
import { describe, it, expect, beforeEach } from 'vitest';
import {
  PHASE, GAME_EVENT, state,
  nextPhase, canTransition, transition,
  isTitle, isPlaying, isPaused, isDead, isGameover, isLive,
} from '../src/state.js';

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
