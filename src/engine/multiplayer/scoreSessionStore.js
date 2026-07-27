// scoreSessionStore.js — small, defensive local cache for the latest
// server-authoritative SCORE frame. This keeps the title-screen read surface
// useful while relay reads settle and across a page reload.

const KEY_PREFIX = 'tq.mp3.latest-score:';
const HEX64 = /^[0-9a-f]{64}$/;
const HEX16 = /^[0-9a-f]{16}$/;
const MAX_TALLIES = 32;
const MAX_COUNT = 1e6;

function count(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= MAX_COUNT ? n : null;
}

export function normaliseScoreFrame(frame) {
  if (!frame || typeof frame !== 'object') return null;
  if (!HEX16.test(frame.sessionId || '') || !Number.isFinite(frame.endedAt) || frame.endedAt < 0) return null;
  if (!Array.isArray(frame.tallies) || frame.tallies.length < 1 || frame.tallies.length > MAX_TALLIES) return null;

  const tallies = [];
  for (const row of frame.tallies) {
    const kills = count(row?.kills);
    const deaths = count(row?.deaths);
    const damage = count(row?.damage);
    if (typeof row?.id !== 'string' || !HEX64.test(row?.npub || '')
        || kills == null || deaths == null || damage == null) return null;
    tallies.push({ id: row.id.slice(0, 64), npub: row.npub, kills, deaths, damage });
  }
  return { t: 'SCORE', sessionId: frame.sessionId, endedAt: frame.endedAt, tallies };
}

export function scoreFrameKey(pubkey) {
  return HEX64.test(pubkey || '') ? KEY_PREFIX + pubkey : null;
}

export function saveLatestScoreFrame(storage, pubkey, frame) {
  const key = scoreFrameKey(pubkey);
  const clean = normaliseScoreFrame(frame);
  if (!key || !clean || !storage || typeof storage.setItem !== 'function') return false;
  try {
    storage.setItem(key, JSON.stringify(clean));
    return true;
  } catch {
    return false;
  }
}

export function loadLatestScoreFrame(storage, pubkey) {
  const key = scoreFrameKey(pubkey);
  if (!key || !storage || typeof storage.getItem !== 'function') return null;
  try {
    const raw = storage.getItem(key);
    return raw ? normaliseScoreFrame(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
