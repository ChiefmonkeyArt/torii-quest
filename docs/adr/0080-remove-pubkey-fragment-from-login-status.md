# ADR-0080: Remove the Nostr pubkey fragment from the login status line

- **Status:** Accepted
- **Date:** 2026-08-28
- **Deciders:** chiefmonkey
- **Related:** v0.2.228 (entry-status line), v0.2.236 (loginBootstrap.js), `src/nostr.js`

## Context

Since v0.2.228 the title screen shows a single `#entry-status` feedback line under
the ENTER TORII button. On a successful NIP-07 login, `nostrLogin()` returned
`` `⚡ ${state.nostrName}` `` where `nostrName = pk.slice(0,8).toUpperCase()` — so
the homescreen surfaced the first 8 hex chars of the player's public key, e.g.
`⚡ EC79B568`.

The maintainer asked to remove this: the raw pubkey fragment is noise on the
homescreen (it is not the display name, and it is not a meaningful identity
handle to a visitor), and it sits in a spot that reads as a status/error line
rather than an identity badge.

## Decision

`nostrLogin()` returns an empty string on success, so the `#entry-status` line
hides after a successful login. The pubkey is still written to
`state.nostrName` (and later overwritten by the kind:0 display name) for the
in-game display-name fallback — only the homescreen status line stops showing
the fragment.

The no-provider (`NIP-07 extension not found`) and error
(`Login failed — approve the request…`) messages are unchanged; only the
success path is affected.

## Consequences

- **Enables:** a cleaner homescreen — no raw hex fragment under the Enter button.
- **Forecloses:** the homescreen no longer gives a visible "who am I logged in
  as" confirmation on the status line itself (the owner caption / greeting
  elsewhere still reflects login state).
- **Trade-offs:** a successful login is now visually silent on the status line
  (the line simply hides). This is accepted per the maintainer's direction.
- **Enforcement:** `tests/login-bootstrap.test.js` asserts the success path
  returns `''` and leaves the status line empty.

## Alternatives considered

- **Show a neutral "Logged in" instead.** Rejected — the maintainer asked to
  remove the ID, not replace it with another string.
- **Show the kind:0 display name on the line.** Rejected — the display name
  already surfaces via the owner caption / profile UI, and the status line is
  the wrong place for it.

## Notes

The pubkey fragment is still visible in-game (e.g. the display-name fallback
until a kind:0 profile resolves). This ADR only covers the title-screen login
status line.
