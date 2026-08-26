# ADR-0072 — Split greeting colours: only the name orange, "logged in" green

- **Status:** Accepted
- **Date:** 2026-08-26
- **Supersedes the colour claim in:** [ADR-0071](./0071-admin-loggedin-caption-reworded-to-greeting.md) (ADR-0071 set the whole greeting line orange; this ADR keeps the rewording but changes the colour split)
- **Version:** v0.2.706-alpha
- **Component:** Owner caption (`#torii-owner-caption`) — top-left "Welcome" greeting + "logged in" badge

## Context

ADR-0071 (v0.2.705) reworded the admin caption to:

```
Welcome <owner name>,
<green dot> you are logged in
```

The whole greeting line 1 was orange (`#f7931a`), and the badge text ("you are logged in") was a single green (`#6DAA45`) run. The owner requested a finer colour split:

> Only put `<your name>` in orange. Change the "Welcome " text to the same colour as the "you are" and the "logged in" should be a complimentary green with the orange to give balance.

In short:

- **Only the owner's name** is orange (the warm focal point).
- **"Welcome "** and **","** take the same neutral tone as **"you are "** — tying the greeting to the caption's existing label colour (`#d8c3ac`), not a third hue.
- **"logged in"** is green (`#6DAA45`) — complimentary to the orange name, so the two-line block reads as a balanced warm/cool pair (orange name ↔ green "logged in") rather than a wall of orange.
- The **green dot** stays green (`#6DAA45`).

## Decision

### DOM

- Line 1 (`#torii-owner-line1`) is rebuilt by `_refreshOwnerLabel` for the admin as three spans built via the **DOM API** (`document.createElement` + `textContent` per span + `line1.append(...)`), never `innerHTML`:
  - `<span class="toc-dim">Welcome </span>`
  - `<span class="toc-name" id="torii-greet-name">{label}</span>`
  - `<span class="toc-dim">,</span>`
  - For non-admin, line 1 is restored to the plain label via `line1.replaceChildren(document.createTextNode('This torii belongs to'))`.
- The badge text is split in the shipped HTML into two spans:
  - `<span class="toc-dim">you are </span>`
  - `<span class="toc-on">logged in</span>`
  - (preceded by the existing `.toc-loggedin-dot`).

### CSS (new rules in `#torii-owner-caption`)

| Selector | Colour | Role |
| --- | --- | --- |
| `.toc-name` | `#f7931a` (orange) | the owner's name — the only orange element |
| `.toc-dim` | `#d8c3ac` (neutral) | "Welcome ", ",", "you are " |
| `.toc-on` | `#6DAA45` (green) | "logged in" |
| `.toc-loggedin-dot` | `#6DAA45` (green) | the live dot (unchanged) |

### CSS change to `.toc-line1.toc-greet`

The `.toc-greet` modifier previously set `color: #f7931a`. That declaration is **removed** so line 1 inherits the base neutral (`#d8c3ac`) for "Welcome "/","; only the `.toc-name` span carries orange. The modifier still sets `font-size: 13px`, `font-weight: 600`, and `text-transform: none` (sentence case, ADR-0071).

### Why DOM API instead of innerHTML

The owner's display name is sourced from a Nostr profile (or a local draft / shortened npub). Using `innerHTML` would let a malicious owner inject markup via their own name (self-XSS). Building the three spans with `createElement` and setting `textContent` per span means the name is always treated as text — no escaping risk, no script execution. Same safety posture as the rest of `_refreshOwnerLabel` (which uses `nameEl.textContent = label`).

## Security / privacy

- Unchanged from ADR-0071: the badge is `display: none` by default and only `.show`-ed when the same `isAdminOperator()` check confirms the logged-in viewer is the instance owner. No pubkey is written into the DOM; only the resolved display label is shown.
- The colour split is purely presentational — it does not change what data is exposed or to whom.

## Trade-offs

- More spans in the caption than ADR-0071's single text node. Acceptable: the gain is the requested colour balance and the safer name-injection posture.
- The neutral tone `#d8c3ac` is the same colour the non-admin "This torii belongs to" label already uses, so the admin greeting reads as a variant of the existing caption rather than a foreign element.
- `replaceChildren` / `append` require a modern browser (Chrome 86+, Safari 14+, Firefox 78+). The Torii browser target already assumes a current Chromium.

## Test / verification

- `tests/main-owner-loggedin-badge.test.js` updated to assert:
  - the greeting is built via DOM API with `toc-dim` / `toc-name` / comma spans and `line1.append(pre, nm, comma)`;
  - non-admin restores the plain label via `replaceChildren(createTextNode('This torii belongs to'))`;
  - the shipped HTML splits the badge into `<span class="toc-dim">you are </span><span class="toc-on">logged in</span>`;
  - the colour rules exist (`.toc-name` orange, `.toc-dim` neutral, `.toc-on` green);
  - `.toc-greet` no longer sets `color: #f7931a` (only `.toc-name` is orange).
- Full suite + screenshot (admin state shows orange name + neutral "Welcome,"/comma + green dot + neutral "you are " + green "logged in"; anonymous state unchanged).

## Consequences

- The admin greeting now has the requested warm/cool balance: orange name ↔ green "logged in", with "Welcome"/","/"you are " in the neutral caption tone.
- ADR-0071's rewording and sentence-case behaviour are preserved; only the colour split changes.
