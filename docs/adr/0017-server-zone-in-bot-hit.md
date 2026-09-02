# ADR-0017 — Plumb `zone` from BOT_HIT into client `applyBotHit`

Status: **Accepted** (v0.2.626)
Deciders: chiefmonkey
Date: 2026-08-22

## Context

v0.2.625-alpha `[SHOT]` diagnostic lines all read `zone=unknown`. Investigation:

- Server broadcasts `MSG.BOT_HIT` with fields `{ botId, dmg, zone, hp, shooterId }`
  (`server/arena-ws.js` line ~640). Server DOES send zone.
- Client wire schema `MSG.BOT_HIT: ['botId','dmg','zone','hp','shooterId']`
  (`src/engine/multiplayer/wireProtocol.js` line ~325). Client wire receives
  zone correctly.
- Client dispatch in `src/arenaRuntime.js` line 1394:
  `applyBotHit(p.botId, p.hp)` — **`p.zone` is dropped**.
- `applyBotHit(botId, hp, zone)` in `src/bots.js` line 391 **already accepts**
  a `zone` argument and uses it: `zone: zone || 'unknown'` in `logBotShot`.

The zone is already flowing end-to-end EXCEPT the final `applyBotHit` call
site. One-line fix.

## Decision

Change one call site in `src/arenaRuntime.js`:

    - applyBotHit(p.botId, p.hp);
    + applyBotHit(p.botId, p.hp, p.zone);

That is the entire fix. No server change. No wire-protocol change. No new
tests beyond a single assertion in the existing bot-hit test that `zone`
propagates.

### Scope guardrails

- Do **not** change server BOT_HIT payload shape.
- Do **not** change `applyBotHit` signature.
- Do **not** add fallback logic — server always sends zone; if it ever
  arrives undefined, `applyBotHit` already handles that with `zone ||
  'unknown'`.

## Consequences

Positive:

- `[SHOT]` diagnostic lines now show `zone=head` or `zone=body` instead of
  `zone=unknown`.
- Unlocks headshot-vs-body accuracy analysis for the next round of bug
  hunts (Bug A close-range client-ray miss).
- Zero risk to gameplay: `zone` is diagnostic-only downstream — nothing in
  the client damage path branches on it (damage is server-authoritative).

Negative:

- None.

## Test plan

Add one assertion in `tests/multiplayer/bot-alive-window.test.js` or a new
`tests/multiplayer/bot-hit-zone.test.js`:

- Simulate a wire `BOT_HIT` message with `zone='head'`; assert the client
  dispatch passes `zone` through to `applyBotHit`; assert the emitted
  diagnostic includes `zone='head'` (not 'unknown').

## Alternatives considered

- **Server-side coercion of zone to string enum.** Zone is already a string
  enum server-side. Rejected — no change needed.
- **Log zone from client-computed aim ray instead.** The client aim ray and
  server hit-resolution can disagree (see Bug A ghost-shooter); zone should
  reflect the server's authoritative decision. Rejected.
