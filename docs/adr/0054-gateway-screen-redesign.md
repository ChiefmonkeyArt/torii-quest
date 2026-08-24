# ADR-0054: Redesign the gateway screen — in-place smoked glass, three columns (v0.2.676-alpha)

- **Status:** Accepted
- **Date:** 2026-08-24
- **Decides:** The in-world gateway screen (KeyF) no longer opens on a blacked-out
  full-screen backdrop. It opens in place — the world stays fully visible behind a
  translucent smoked-glass card — and lists live worlds in three columns: **Friends**
  (mutual follows), **Follows** (people you follow), and **Games** (instances that
  have published a game).

## Context

The gateway screen was a full-screen modal with a dark radial-gradient backdrop that
obscured the world, and a single flat "worlds online" list. The user asked for it to
open in place with the surrounding world visible, on a smoked-glass panel, with three
columns separating social (friends/follows) from games.

The three-way classification already existed: `classifySections` (used by the Torii
menu, KeyM) partitions live worlds worlds into `friends` (mutual), `following` (you
follow, not mutual), and `games` (zoneType `arena` or game/experience topics). The
gateway screen simply wasn't using it.

## Decision

- `gatewayScreen.js` is rewritten: transparent backdrop (no dimming), a smoked-glass
  card (`rgba` + `backdrop-filter: blur`), and a three-column grid — Friends, Follows,
  Games — each with a header + live count and a list of clickable world rows.
- `main.js`'s `getGatewayScreenState` now returns `{ friends, following, games }`
  (via `classifySections`) instead of a flat `worlds` array.
- `arenaRuntime.js` forwards the three columns to `openGatewayScreen` (and its
  fallback hook matches the new shape).

## Consequences

- The player never loses sight of the world while browsing the gateway.
- Friends and Follows are social (mutual / one-way follows); Games is the published
  game directory — matching the user's "instances of Quest that have created a game".
- No travel/handshake behaviour changes; `onTravel` is unchanged.
- `GATEWAY_SCREEN_VERSION` bumps to 2.
