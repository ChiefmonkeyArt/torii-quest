// tests/torii-quest-dashboard.leaderboard.test.js — MP-3 (v0.2.366-alpha)
// Locks the LEADERBOARD tile model on the dashboard.
import { describe, it, expect } from 'vitest';
import {
  LEADERBOARD_BADGE, LEADERBOARD_LASTKNOWN, buildLeaderboardModel,
  buildToriiQuestModel, toriiQuestDataJSON, TORII_QUEST_VERSION,
} from '../src/engine/dashboard/toriiQuestDashboardData.js';

describe('LEADERBOARD_BADGE / LASTKNOWN', () => {
  it('badge string is stable', () => {
    expect(LEADERBOARD_BADGE).toBe('LEADERBOARD · TOP 5 · NOSTR-BACKED · READ-ONLY');
  });
  it('lastknown starts empty and carries the current version', () => {
    expect(LEADERBOARD_LASTKNOWN.version).toBe(TORII_QUEST_VERSION);
    expect(LEADERBOARD_LASTKNOWN.rows).toEqual([]);
  });
});

describe('buildLeaderboardModel', () => {
  it('empty by default and marks .empty=true', () => {
    const m = buildLeaderboardModel();
    expect(m.rows).toEqual([]);
    expect(m.empty).toBe(true);
    expect(m.badge).toBe(LEADERBOARD_BADGE);
  });

  it('takes at most 5 rows and normalises fields', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({
      rank: i + 1, display: `p${i}`, kills: i, kd: (i / 2).toFixed(2),
    }));
    const m = buildLeaderboardModel({ rows });
    expect(m.rows).toHaveLength(5);
    expect(m.rows[0].rank).toBe(1);
    expect(m.empty).toBe(false);
  });

  it('defaults out missing fields defensively', () => {
    const m = buildLeaderboardModel({ rows: [{}, { kd: 1 }] });
    expect(m.rows[0].rank).toBe(1);
    expect(m.rows[0].display).toBe('');
    expect(m.rows[0].kills).toBe(0);
    expect(m.rows[0].kd).toBe('0.00');
    expect(m.rows[1].kd).toBe('1');
  });
});

describe('buildToriiQuestModel.leaderboard', () => {
  it('exposes a leaderboard tile by default', () => {
    const m = buildToriiQuestModel();
    expect(m.leaderboard).toBeTruthy();
    expect(m.leaderboard.badge).toBe(LEADERBOARD_BADGE);
    expect(m.leaderboard.empty).toBe(true);
  });
  it('accepts overrides.leaderboard', () => {
    const override = buildLeaderboardModel({ rows: [{ rank: 1, display: 'aaa…zzz', kills: 3, kd: '3.00' }] });
    const m = buildToriiQuestModel({ leaderboard: override });
    expect(m.leaderboard.rows[0].kills).toBe(3);
  });
});

describe('toriiQuestDataJSON — leaderboard shape', () => {
  it('serialises the leaderboard field', () => {
    const json = toriiQuestDataJSON(buildToriiQuestModel());
    expect(json.leaderboard).toBeTruthy();
    expect(json.leaderboard.rows).toEqual([]);
  });
});
