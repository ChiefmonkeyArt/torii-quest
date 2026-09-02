# ADR-0070: Admin-Only "Logged In" Badge on the Owner Caption

- **Status:** Accepted
- **Date:** 2026-08-26
- **Deciders:** chiefmonkey
- **Related:** ADR-0069 (pause modal recolor), `index.html` (`#torii-owner-caption` DOM + CSS), `src/main.js` (`_refreshOwnerLabel`), `src/engine/identity/toriiOwnerLabel.js` (`resolveToriiOwnerLabel`), `src/engine/update/adminUpdateClient.js` (`isAdminOperator`)

## Context

The top-left homescreen caption "This torii belongs to: \<owner\>" (`#torii-owner-caption`, populated by `_refreshOwnerLabel()` in `src/main.js`) names the instance owner to every visitor. The owner asked for a small **green dot + the text "logged in"** to appear to the right of that name, visible **only to the owner themselves when they are logged in via Nostr**.

The instance already knows who the owner is: the configured admin pubkey arrives as `capability.adminPubkey`, and the logged-in viewer's pubkey lives in `state.nostrPubkey`. The shell already compares these with `isAdminOperator(operatorPubkey, adminPubkey)` (pure, tested in `tests/admin-update-client.test.js`) at three other call sites in `main.js` (`_refreshUpdateButton`, gateway travel, the menu model).

## Decision

Add an admin-only "logged in" badge to the owner caption, toggled from the existing `isAdminOperator()` check — no new auth, no new fetch, no pubkey surfaced in the DOM.

**DOM** (`index.html`, `.toc-line2`): the name now lives in its own truncating span `<span class="toc-owner-name" id="torii-owner-name">`, followed by `<span class="toc-loggedin" id="torii-loggedin-badge"><span class="toc-loggedin-dot" aria-hidden="true"></span>logged in</span>`. Splitting the name into its own span lets the badge sit to its right without being clipped by the ellipsis truncation that kept the long-name-wrapping fix from ADR-0069 intact.

**CSS** (`index.html`): `.toc-line2` becomes a flex row (`display: flex; align-items: center; gap: 7px`); the name span carries the `white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0` so it truncates and the badge stays visible. The badge is `display: none` by default and only `display: inline-flex` when it carries the `.show` class — so it never flashes before login resolves. The dot is a 7px green (`#6DAA45`, the Nexus dark-mode success green — readable over the dark sunset photo) disc with a soft glow (`box-shadow: 0 0 8px rgba(109,170,69,0.7)`) and a gentle 2s opacity pulse; `prefers-reduced-motion` disables the animation.

**JS** (`_refreshOwnerLabel`): after resolving the label text into `#torii-owner-name`, the function toggles the badge: `const isOwner = !!(adminPubkey && isAdminOperator(state.nostrPubkey || '', adminPubkey)); badge.classList.toggle('show', isOwner);`. Because `_refreshUpdateButton` (which calls `_refreshOwnerLabel`) is already wired to `EV.NOSTR_LOGIN` and to the capability-probe resolve, the badge updates on every login and capability re-probe with no extra event wiring.

## Why these choices

- **Reuse `isAdminOperator`, don't reinvent it.** The owner/pubkey comparison is already the canonical admin check at three other call sites; a second definition would drift. The badge decision is a pure function of the already-tested helper.
- **`display: none` by default, `.show` to reveal — never the reverse.** The badge starts hidden and is only revealed once login is confirmed, so an anonymous or non-admin visitor never sees it flicker in. Hiding is the fail-closed state.
- **Green dot + the text "logged in".** Color is never the only signal (accessibility: the literal text is always present when shown); the dot is the live "light" affordance the owner asked for, the text is the screen-reader-readable confirmation.
- **No pubkey in the DOM.** The badge only toggles a CSS class — `textContent`/`title`/`innerHTML` are never assigned the npub. The owner's name comes from `resolveToriiOwnerLabel` exactly as before; nothing about the public caption changes for other visitors.
- **Layout change is scoped to the caption line.** Making `.toc-line2` flex is the minimal change that lets a right-side badge coexist with an ellipsis-truncated name; no other surface is touched.

## Alternatives considered

- **Show the badge for any logged-in user, not just the owner.** Rejected — the owner specifically asked for it to mark when the admin is logged in, and showing "logged in" next to someone else's name on someone else's torii would be confusing.
- **Gate the badge on `state.isLoggedIn` / display-name presence.** Rejected — `isLoggedIn` is true for any authenticated visitor, and a display name can be set by a non-owner. Only the pubkey equality via `isAdminOperator` authoritatively says "this viewer IS the configured owner."
- **Reveal the owner's npub in the badge title.** Rejected on privacy grounds; the name already comes from the published profile / local draft, and the badge adds no new data.

## Consequences

- The owner sees a green pulsing "logged in" light beside their name on the top-left caption when they are authenticated as the instance owner; everyone else sees only the name, unchanged.
- The badge re-evaluates on every `NOSTR_LOGIN` and capability re-probe. There is no explicit logout flow on the title screen today; on a full page reload the pubkey is empty and the badge is hidden by default, so a stale "logged in" state cannot persist past a reload. If a future explicit logout is added, it should call `_refreshOwnerLabel()` (or `_refreshUpdateButton()`) to re-hide the badge.
- No new tests for `isAdminOperator` itself (already covered); the wiring is locked at the source level in `tests/main-owner-loggedin-badge.test.js` (6 assertions: name-span render, badge `.show` toggle from `isAdminOperator`, no pubkey write to DOM, name stays visible to all, no scope creep, and the shipped HTML/CSS ships the badge hidden-by-default with a decorative dot + readable text).

## Version

v0.2.704-alpha. Companion to ADR-0068 (boot overlay recolor) and ADR-0069 (pause modal recolor) — the three recolored player-facing surfaces; this is the first to add a new element rather than restyle an existing one.
