# ADR-0039: 2-Way Ema Comms — AI Replies in the Emagake Rack

- **Status:** Accepted
- **Date:** 2026-08-23
- **Deciders:** chiefmonkey
- **Related:** ADR-0025 (sealed ema), ADR-0038 (rotated Kami key + AI read path), `src/engine/kami/emagakePanel.js`, `src/engine/kami/kamiMode.js`, `server/kami/kamiReplyStore.js`, `server/kami/kamiReplyRoute.js`, `tools/kami-reply.mjs`

## Context

ADR-0038 wired direction 1 (user → AI): the owner hangs an ema in-browser,
it is sealed to `[ownerPub, KAMI_PUBKEY]` and persisted on the VPS as ciphertext;
the AI runs `tools/kami-read.mjs` with the Kami private key to decrypt + read it.

Direction 2 (AI → user) was missing. The owner wants **2-way communication
through ema and emagake**: the AI reads an ema, replies, and the reply appears
in the in-game emagake rack.

The hard constraint: **the browser cannot decrypt a `kamiSeal` envelope.** The
seal uses a custom ECDH + HKDF + AES-256-GCM construction, and NIP-07 (window.nostr)
only signs events — it never exposes the owner's private key for ECDH, and it is
not NIP-04/NIP-44. So an AI reply sealed the same way the ema is would be
unreadable in-game, and the ema backlog itself is not renderable in-browser
(the current rack only shows DRAFT ema held in the session tray, never the
sealed backlog).

## Decision

Add a **separate plaintext "replies" feed** alongside the sealed ema store.

- **Schema is self-contained.** Because the browser cannot decrypt the original
  ema a reply refers to, each reply carries an optional short `quote` (≤280 chars)
  excerpt of that ema, so every rack row reads on its own:
  `{ v: 1, id, ts, from: 'kami', ref, quote, text }`.
- **AI replies are plaintext, not sealed.** They are AI-generated responses
  derived from the owner's own notes — low sensitivity (the owner already holds
  the plaintext of their own ema). The owner judged these "banal anyway" and the
  key is rotatable (ADR-0038). Sealing would make them unreadable in-browser for
  no security gain.
- **Server:** `kamiReplyStore.js` holds an append-only `replies.jsonl` in the
  same kami dir; `kamiReplyRoute.js` exposes pure `parseSince` + `shapeReplyResponse`
  helpers. `arena-ws.js` adds an admin-gated (owner Bearer session token)
  `GET /mp/kami/replies?since=<ts>` route that returns only rows newer than the
  client's high-water mark.
- **AI posts replies** via `tools/kami-reply.mjs`, a Node tool run ON THE VPS
  (through the existing VPS runner). It NEVER trusts shell quoting for message
  text: the reply text is read from a file (`--text-file`) or stdin, not a shell
  arg; only short safe strings may use `--text`. It validates, length-caps, and
  atomically appends to `replies.jsonl`.
  **Must run as the `torii-quest` service user** — the kami dir
  (`/var/lib/torii-quest/kami`, mode 700, owned `torii-quest`) is not writable by
  `ubuntu`. The arena-ws server already writes there as that user; the manual tool
  must match: `sudo -u torii-quest node tools/kami-reply.mjs --text-file /tmp/r.txt`.
  The tool imports only `node:fs` (no `@noble/curves`), so no deps are needed.
- **Client:** `kamiMode.js` polls `GET /mp/kami/replies?since=<lastTs>` every ~5s
  while in Kami Mode + an owner token is present, stops on exit. `emagakePanel.js`
  renders reply rows as a distinct block above the ema rack (`ema-row kami-reply`,
  ⛩ stud), newest-first, deduped by id via `mergeReplies`. **textContent only,
  never innerHTML** — AI reply text must not be able to inject markup into the
  owner's own panel.

## Consequences

- The emagake rack now shows two things: AI replies (top, distinct styling) and
  the session's DRAFT ema tray (below, as before). The sealed ema backlog stays
  server-side ciphertext, readable only by the AI with the Kami private key.
- Direction 2 is intentionally NOT sealed. If a future reply needs secrecy, the
  channel would have to change shape (e.g. a NIP-04/NIP-44 sealed reply the owner
  decrypts via NIP-07, or a second key the browser CAN use) — out of scope here.
- The Kami private key (ADR-0038, at `/home/user/workspace/.secrets/kami-priv.hex`)
  is used only for direction 1 (reading ema). It is NOT needed to post a reply;
  `kami-reply.mjs` writes plaintext and never touches the private key.

## Test coverage

- `tests/kami/kami-reply-store.test.js` — append/read-since, malformed line
  ignored, text/quote caps, ref/from round-trip.
- `tests/kami/kami-reply-route.test.js` — `parseSince` edge cases,
  `shapeReplyResponse` caps + HTML-stays-string + default coercion.
- `tests/kami/emagake-reply-render.test.js` — reply rows render with the
  `kami-reply` class, textContent-not-innerHTML (HTML stays as text), replies
  above ema rows newest-first, empty state only when both empty, `mergeReplies`
  dedup + cap.

24 new tests; 3175 full suite green; build clean.
