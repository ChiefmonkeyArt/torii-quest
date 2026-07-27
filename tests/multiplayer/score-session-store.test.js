import { describe, expect, it } from 'vitest';
import {
  loadLatestScoreFrame, normaliseScoreFrame, saveLatestScoreFrame, scoreFrameKey,
} from '../../src/engine/multiplayer/scoreSessionStore.js';

const PUB = 'a'.repeat(64);
const FRAME = {
  t: 'SCORE',
  sessionId: '1'.repeat(16),
  endedAt: 1234,
  tallies: [{ id: 'peer-1', npub: PUB, kills: 3, deaths: 1, damage: 27 }],
};

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe('latest SCORE frame persistence', () => {
  it('round-trips a defensive copy per player pubkey', () => {
    const store = storage();
    expect(saveLatestScoreFrame(store, PUB, FRAME)).toBe(true);
    expect(loadLatestScoreFrame(store, PUB)).toEqual(FRAME);
    expect(scoreFrameKey(PUB)).toContain(PUB);
  });

  it('rejects malformed identities, sessions, and counters', () => {
    expect(normaliseScoreFrame({ ...FRAME, sessionId: 'bad' })).toBeNull();
    expect(normaliseScoreFrame({
      ...FRAME,
      tallies: [{ ...FRAME.tallies[0], kills: -1 }],
    })).toBeNull();
    expect(saveLatestScoreFrame(storage(), 'not-a-pubkey', FRAME)).toBe(false);
  });

  it('fails closed on unavailable or corrupt storage', () => {
    expect(loadLatestScoreFrame(null, PUB)).toBeNull();
    expect(loadLatestScoreFrame({ getItem: () => '{bad' }, PUB)).toBeNull();
    expect(saveLatestScoreFrame({ setItem: () => { throw new Error('quota'); } }, PUB, FRAME)).toBe(false);
  });
});
