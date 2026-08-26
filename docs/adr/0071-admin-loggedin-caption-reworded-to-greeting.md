# ADR-0071: Admin Logged-In Caption Reworded to "Welcome <name>, you are logged in"

- **Status:** Accepted
- **Date:** 2026-08-26
- **Deciders:** chiefmonkey
- **Related:** ADR-0070 (admin-only logged-in badge), `index.html` (`#torii-owner-caption` DOM + CSS), `src/main.js` (`_refreshOwnerLabel`)

## Context

ADR-0070 added an admin-only green dot + "logged in" badge to the right of the owner's name on the top-left "This torii belongs to" caption. The owner asked to reword the admin-logged-in state to a greeting: **"Welcome <display name>, you are logged in"**, with a line break (shift+return) after the comma — so the name sits on the first line and the status on the second. The exact sentence case was quoted, so the existing `text-transform: uppercase` on the caption label and badge must not apply to the admin text.

## Decision

Reframe the admin-logged-in caption as a two-line greeting, toggled from the same `isAdminOperator()` check as ADR-0070. Non-admin/anonymous visitors are unchanged.

**When the viewer IS the owner (admin logged in):**
- Line 1 becomes `Welcome <owner name>,` — rendered prominent (13px orange, bold) and sentence-case via a new `.toc-line1.toc-greet` class that overrides the default 9px uppercase label style. The owner name comes from the same `resolveToriiOwnerLabel()` result, so draft/published/shortened-npub priority is unchanged.
- Line 2 becomes the green dot + `you are logged in` (the badge from ADR-0070, with its text changed from `logged in` to `you are logged in` and `text-transform: none` so it renders in the quoted sentence case, not `YOU ARE LOGGED IN`).
- The name span (`#torii-owner-name`) is hidden on line 2, since the name now lives in the greeting on line 1.

**When the viewer is NOT the owner (non-admin / anonymous):**
- Line 1 stays `This torii belongs to` (9px gray uppercase — the default `.toc-line1` style, `.toc-greet` removed).
- Line 2 shows the owner's name (`#torii-owner-name`, 13px orange) exactly as before ADR-0070/0071.
- The badge is hidden (`display: none` by default, `.show` not applied).

**CSS** (`index.html`): `.toc-line1` gains `overflow: hidden; text-overflow: ellipsis` so a long name in `Welcome <name>,` truncates gracefully (full name on hover via the `title` attribute). New `.toc-line1.toc-greet { font-size: 13px; color: #f7931a; font-weight: 600; text-transform: none; }`. The badge `.toc-loggedin` changes `text-transform: uppercase` → `text-transform: none`. The ADR-0070 `:has(.toc-loggedin.show)` widen to 220px on viewports ≥480px still applies (now triggered by the admin state), keeping a short name from being clipped.

**JS** (`_refreshOwnerLabel`): computes `isOwner` once, then branches — admin sets line 1 to `Welcome ${label},` + `.toc-greet`, hides the name span, and toggles the badge `.show`; non-admin restores `This torii belongs to`, removes `.toc-greet`, shows the name span. `badge.classList.toggle('show', isOwner)` is retained, so the badge reveal is still the single fail-closed toggle from ADR-0070.

## Why these choices

- **Minimal toggle, not two swapped blocks.** Branching on `isOwner` within the existing line1 / name / badge elements keeps the public caption path untouched and avoids duplicating the owner-name resolution. The DOM structure from ADR-0070 is reused, not rebuilt.
- **Sentence case is explicit.** The owner quoted `"Welcome <display name>, you are logged in"`. Both the label and badge carried `text-transform: uppercase`; without overriding it the admin would see `WELCOME <NAME>,` / `YOU ARE LOGGED IN`. `.toc-greet` and the badge's `text-transform: none` make the quoted case render exactly.
- **Name prominence preserved.** Moving the name from the 13px line 2 into the greeting could have shrunk it to the 9px label size. `.toc-greet` keeps it 13px orange bold so the owner is genuinely greeted by name.
- **No new auth, no pubkey leak.** Same `isAdminOperator(viewer, adminPubkey)` gate as ADR-0070 and the three other shell call sites. The badge still only toggles a CSS class — the owner's npub is never written to the DOM.

## Consequences

- The admin sees `Welcome <name>,` / green-dot `you are logged in` when logged in; everyone else sees the standard caption, unchanged.
- Re-evaluated on every `NOSTR_LOGIN` and capability re-probe (same wiring as ADR-0070); the greeting and badge swap atomically in one `_refreshOwnerLabel` call, so there is no flicker between the two states. As with ADR-0070, a future explicit logout should call `_refreshOwnerLabel()` to revert to the public caption.
- Tests: `tests/main-owner-loggedin-badge.test.js` is extended (6 assertions) to lock the greeting swap (line 1 text + `.toc-greet` toggle), the name-span hide/show, the sentence-case CSS (`text-transform: none` on both `.toc-loggedin` and `.toc-line1.toc-greet`), and the shipped `you are logged in` text. The pure `isAdminOperator()` coverage is unchanged.

## Version

v0.2.705-alpha. Supplements ADR-0070 (admin-only logged-in badge); same surface, reworded.
