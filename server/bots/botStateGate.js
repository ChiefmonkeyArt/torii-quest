// botStateGate.js — ADR-0050 v0.2.672. Pure helpers for the server's BOT_STATE
// broadcast decision, extracted from arena-ws.js's bot loop so the fix is
// unit-testable (the loop itself is a side-effectful setInterval).
//
// The bug: the broadcast gate was `players.length > 0`, where `players` EXCLUDES
// Kami Mode sessions (ADR-0032 "bots ignore the admin"). A sole player in Kami
// Mode dropped `players.length` to 0, silencing BOT_STATE for the whole Kami Mode
// session and freezing every bot on the client — the ~12m desync behind the
// "bots won't die" bug.
//
// The fix: count authed sessions SEPARATELY from the bot-brain roster. The roster
// still excludes Kami Mode (bots ignore the admin), but the broadcast gate keys off
// `authedCount` (anyone authed, Kami Mode or not) so the stream never goes silent.

/**
 * Build the per-tick bot-brain roster AND the authed-session count.
 *
 * @param {Map} sessions - session map (sess.authed, sess.pos, sess.id)
 * @param {object} deps
 * @param {Function} deps.isKamiActive - (sess) => boolean (re-verifies admin pubkey)
 * @param {Function} deps.pointInCoastline - (x, z) => boolean (fence test)
 * @returns {{ players: Array, authedCount: number }}
 */
export function buildBotTickRoster(sessions, { isKamiActive, pointInCoastline }) {
  const players = [];
  let authedCount = 0;
  for (const sess of sessions.values()) {
    if (!sess.authed) continue;
    authedCount++;
    if (isKamiActive(sess)) continue;
    const [x, y, z] = sess.pos;
    players.push({
      id: sess.id,
      x, y, z,
      outsideFence: !pointInCoastline(x, z),
      flyEnabled: false,
    });
  }
  return { players, authedCount };
}

/**
 * Should BOT_STATE be broadcast this tick? True when at least one authed session
 * exists (Kami Mode or not) AND the throttle window has elapsed.
 *
 * @param {object} p
 * @param {number} p.authedCount - authed sessions this tick
 * @param {number} p.now - current ms clock
 * @param {number} p.lastAt - ms clock of the last broadcast (0 = never)
 * @param {number} p.botStateMs - throttle period
 * @returns {boolean}
 */
export function shouldBroadcastBotState({ authedCount, now, lastAt, botStateMs }) {
  return authedCount > 0 && (now - lastAt) >= botStateMs;
}
