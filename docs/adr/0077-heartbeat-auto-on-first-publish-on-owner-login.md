# ADR-0077: Heartbeat Auto-On — First Publish Fires on Owner Login

- **Status:** Accepted
- **Date:** 2026-08-27
- **Deciders:** chiefmonkey (+ Perplexity Computer agent)
- **Related:** ADR-0076 (trusted starter relays), ADR-0068 (original consent-gated heartbeat), `src/main.js` (`_heartbeatTick`), `src/engine/presence/heartbeat.js` (`isHeartbeatDue`), `src/engine/settings/heartbeatPanel.js`

## Context

ADR-0068 shipped the node-presence heartbeat as a **consent-gated, opt-in** feature:
intent defaults to `'on'` in `localStorage`, but the **first** publish was
explicit-via-toggle only. `_heartbeatTick` (the rAF-loop republisher) deliberately
refused to fire when `_heartbeat.lastPublishedAt === null` (main.js guard), and
`isHeartbeatDue(null)` returns `false` — so a fresh install that had never toggled
the heartbeat never published anything, even with intent `'on'` and the owner
logged in. The only way to start the beacon was to open Settings → Heartbeat and
flip the toggle (which triggered the NIP-07 `window.nostr.signEvent` prompt —
approving it was the consent).

The product requirement changed. The owner (Bekka) wants the heartbeat to **just
work**: "when a user/admin logs into their instance for the first time the
Heartbeat should start beating by default… they can then turn it off if they
want." "Open by default." "Without the player having to think about it." With
ADR-0076's trusted starter relays now in place, the remaining blocker to a
zero-config beacon was this manual-first-publish gate.

Forces:
- **Product:** zero-config — install, log in, beacon. No settings visit required.
- **Consent:** Nostr still requires the user to approve a `signEvent` (the wallet
  extension prompts). The login click (the user explicitly chose to log in with
  their Nostr identity) is the user gesture that authorises that prompt.
- **Nuisance:** if the wallet is set to "ask every time," republish would prompt
  every 10 min. The existing `republishPaused` flag (set on signer rejection/throw)
  must therefore gate re-prompting so the heartbeat never nags.

## Decision

The heartbeat is **on by default and auto-fires the first publish when the owner
logs in.** Remove the manual-first-publish gate from `_heartbeatTick` and drive
the first publish from the tick itself:

- `const firstPublishDue = _heartbeat.lastPublishedAt === null;`
- `const intervalDue = isHeartbeatDue({ lastPublishedAt, now, intervalMs });`
- publish if `firstPublishDue || intervalDue` (all other guards unchanged:
  intent `'on'`, `isOwner`, `window.nostr.signEvent` present, not `republishPaused`).

`isHeartbeatDue`'s contract is **unchanged** — it still returns `false` for
`null` (the first-publish check is local to `_heartbeatTick`, not pushed into the
pure helper, so its tests + status UI don't drift). The menu toggle is retained
as the **OFF / re-enable-after-pause** path (re-enabling clears a pause and
re-publishes immediately, no waiting for the next tick).

The NIP-07 signer prompt that fires on first publish is the implicit consent —
the owner logging in authorised it. A signer rejection/throw sets
`republishPaused = true`, so the heartbeat never re-prompts automatically; the
operator can re-toggle to retry. If the wallet is set to "always allow" for the
site, republishes are silent.

## Consequences

- **Enables:** true zero-config — install, log in, beacon + be discoverable. No
  settings visit, no relay hunt, no manual toggle.
- **Forecloses:** "the first publish requires an explicit toggle." A fresh owner
  login now auto-prompts the NIP-07 signer (once). This is the intended trade.
- **Trade-offs:** the beacon is still **client-side** — it only beats while the
  owner's browser tab is open + the wallet signer is reachable. It is NOT yet a
  permanent always-on beacon; that needs a future delegated/server signer (the
  MP `arena-ws` server signing presence with an instance-bound key, so the beacon
  stays live without a browser tab). Documented as the next evolution; not in
  scope here.
- **Enforcement:** the `_heartbeatTick` change is covered by the existing
  heartbeat status tests + the manual cloud-browser verification at deploy time
  (confirm the toggle reaches `live` after owner login, presence publishes to the
  ADR-0076 starter relays). `isHeartbeatDue`'s own unit tests are unchanged (its
  contract is intact). The heartbeatPanel idle label + hint copy assert the new
  "on by default — starts on owner login" wording (no longer implies a manual
  toggle).

## Alternatives considered

- **Keep the manual first-publish toggle (status quo).** Rejected: it directly
  contradicts the changed product requirement ("without the player having to
  think about it"). The login is already a deliberate user action.
- **Push the first-publish-due logic into `isHeartbeatDue` (make `null` → true).**
  Rejected: it would change the pure helper's contract + ripple into its tests and
  the status-UI's `isHeartbeatBroadcasting` decision. Localising the check inside
  `_heartbeatTick` keeps the blast radius small + auditable.
- **Server-side delegated signer (truly silent always-on beacon).** Deferred: the
  right long-term answer, but a larger change (instance key management, server
  signing path). This ADR ships the client-side auto-on now and leaves the
  server-side beacon as the next phase.
