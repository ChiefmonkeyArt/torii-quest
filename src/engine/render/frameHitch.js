// ADR-0141: counts long frames (freezes) so a capture says WHEN and HOW LONG
// the game stalled, not just that the 1 Hz recording fell behind. Pure; the
// caller feeds wall-clock timestamps (ms). No allocation per frame.
export const HITCH_MS = 100;   // a frame this long is a visible freeze
const RECENT = 8;

export function createHitchMeter({ thresholdMs = HITCH_MS } = {}) {
  let last = -1, frames = 0, long = 0, maxMs = 0, totalLongMs = 0;
  const recent = new Array(RECENT).fill(null).map(() => ({ at: 0, ms: 0 }));
  let head = 0, filled = 0;
  function note(nowMs) {
    if (last >= 0) {
      const ms = nowMs - last;
      frames++;
      if (ms > maxMs) maxMs = ms;
      if (ms >= thresholdMs) {
        long++; totalLongMs += ms;
        const r = recent[head]; r.at = Math.round(nowMs); r.ms = Math.round(ms);
        head = (head + 1) % RECENT; if (filled < RECENT) filled++;
      }
    }
    last = nowMs;
  }
  /** Forget the gap across a pause (tab hidden, menus) so it isn't a "freeze". */
  function resume() { last = -1; }
  function stats() {
    const out = [];
    for (let i = 0; i < filled; i++) { const r = recent[(head - filled + i + RECENT) % RECENT]; out.push({ at: r.at, ms: r.ms }); }
    return { frames, long, maxMs: Math.round(maxMs), totalLongMs: Math.round(totalLongMs), recent: out };
  }
  return { note, resume, stats };
}
