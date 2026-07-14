// events.js — event bus. Modules talk through named events here instead of
// importing each other directly. This is the decoupling seam: a publisher emits,
// any number of subscribers react, and neither side knows about the other.
//
// EV is the canonical registry — emit/on ONLY with an EV.* name so the set of
// signals stays discoverable in one place (the regression check rejects any
// EV.<NAME> reference that isn't defined here). Some entries are live seams with
// no subscriber yet (PHASE_CHANGE, WS_*); emitting to an empty listener list is a
// harmless no-op, so wiring a publisher ahead of its consumers is safe.
const _listeners = {};
export const EV = Object.freeze({
  HUD_UPDATE:     'hud:update',
  PLAYER_HIT:     'player:hit',
  PLAYER_KILLED:  'player:killed',
  PLAYER_RESPAWN: 'player:respawn',
  BOT_HIT:        'bot:hit',
  BOT_HIT_BY_PLAYER: 'bot:hitByPlayer', // weapon bullet struck a bot; payload {bot,dmg}
  BOT_KILLED:     'bot:killed',
  SHOOT:          'player:shoot',
  NOSTR_LOGIN:    'nostr:login',
  PHASE_CHANGE:   'game:phase',   // emitted by state.transition(); payload {from,to,event}
  WS_PLAYER_HIT:  'ws:playerHit',
  WS_CHAT:        'ws:chat',
  // v0.2.384-alpha: a server-authoritative SCORE frame arrived (MP). Payload is
  // the raw frame { sessionId, endedAt, tallies }. Consumed by the homescreen
  // leaderboard preview + the personal stats board so both reflect the same
  // ledger the in-arena LOCAL leaderboard uses.
  SCORE_FRAME:    'score:frame',
});
export function on(ev, fn)  { (_listeners[ev] ||= []).push(fn); }
export function off(ev, fn) { _listeners[ev] = (_listeners[ev]||[]).filter(f=>f!==fn); }
export function emit(ev, data) { (_listeners[ev]||[]).forEach(fn => fn(data)); }
