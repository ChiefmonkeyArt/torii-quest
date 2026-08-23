# ADR-0025 — Kami Mode: the owner's sealed in-world note-taking surface

**Status:** Accepted
**Version:** v0.2.634-alpha
**Date:** 2026-08-22
**Type:** Feature (new subsystem; no gameplay behaviour change)
**Follows:** ADR-0024 (the lag-comp fix this version also ships)

## Context

Playtesting Torii Quest produces a stream of small, situated observations: "this
button label is wrong", "the dead bot is still shooting here", "the nameplate
floats with no bot under it". These are useless detached from WHERE they were
seen. A note typed into a separate file loses the coordinates, the crosshair
target, and the frame that showed the problem.

The owner (the VPS admin) needed a way to capture a note **in the moment**, pinned
to the exact world position or UI control under the cursor, with a screenshot of
the game as it was at the instant of the problem — and to do it without breaking
flow (note three things in a row, then save once).

Two hard constraints from the owner shaped everything:

1. **Owner-only.** "Kami mode should only be available to the admin the owner of
   the vps." It is not a player feature.
2. **Private at rest.** "These are also private chats so the messages on the local
   vps should be cryptographically locked private." Notes may contain sensitive
   detail; the VPS disk must never hold them in plaintext.

## Decision

### Kami Mode — the owner's authoring surface

A shrine gate (torii) is where the kami (the spirit) inhabits the shrine. Kami Mode
is the owner standing inside their own world, unseen, able to mark and change it.
The notes are **ema** (絵馬) — the wooden plaques a visitor writes on and hangs up.
The rack they hang on is the **emakake** (絵馬掛け).

**Capture flow** (ordered deliberately):

1. Grab the canvas frame FIRST, before any overlay exists — the screenshot must
   show the game as it was at the moment of the problem, not the note box. This
   uses `requestFrameGrab()` (added to `scene.js`), which drains in the same tick
   as the render, before the drawing buffer is cleared. Zero cost when the queue
   is empty.
2. Release pointer lock. While locked, keystrokes belong to the game and a
   textarea cannot receive them.
3. Collect the note. Enter hangs it into the tray; Escape discards.
4. Re-lock and hand control back, so noting three things in a row never breaks
   flow.

Nothing is sent until the owner hangs the tray: one seal pass, one POST, one
write. The tray is capped at 24 (`TRAY_MAX`); hanging is the only way to flush it.

**Entry points:** Ctrl+E (hotkey, opens the note box) / Ctrl+Shift+E (hangs the
tray); a "⛩ HANG AN EMA" button in the pause modal (`#btn-kami`).

### Split seal — the storage model that makes the cull rule expressible

The owner's cull rule is asymmetric: **screenshots default to on, then cull
anything after 420**; **text and state are kept (until the owner clears them
manually)**. The screenshot is the only bulky part; culling it must NOT cost the
note.

If text and image were one sealed blob, the server could not tell which is which
and would have to cull whole ema (losing notes) or keep everything (unbounded
disk). So the ema record and the screenshot are **sealed separately**:

```
POST {v:1, batch:[{ id, ema: <envelope>, shot: <envelope>|null }]}
```

- `ema` — the small record (note, meta, ToriiDebug snapshot), sealed as JSON via
  `sealJson`. Stored in `ema.jsonl`, **append-only, forever**.
- `shot` — the large JPEG bytes, sealed as raw bytes via `sealTo`. Stored as
  `shots/<id>.bin`, **ring-buffered to 420**: when the count exceeds the cap the
  oldest-mtime files are deleted.

The server only ever holds ciphertext and never holds a private key. It validates
shape only (`{v:1, batch:[{id, ema, shot?}]}`, ≤64 entries) and never inspects
sealed contents.

### Hybrid sealed-box encryption (deliberately NOT NIP-44)

Ema are sealed **in the browser** before they are sent. The scheme is a hybrid
envelope:

1. A fresh random 256-bit content key (CEK) encrypts the payload ONCE.
2. The CEK is wrapped separately for each recipient (ECDH ephemeral → HKDF-SHA256
   → AES-256-GCM).

Payload-once matters: a screenshot ema is ~200 KB, and per-recipient payload
encryption would double stored bytes for every extra reader.

Recipients are always **the owner's key AND the Kami key** (whose private half
lives off-box). Dropping a recipient revokes that reader for all future ema;
already-sealed ema stay readable by whoever they were sealed to.

**Why not NIP-44.** Ema never touch a relay (owner's explicit decision: "local
only... no need for them to be nostr events ever"), so wire-format compatibility
with other Nostr clients buys nothing, and strict NIP-44 v2 would add a
`@noble/ciphers` dependency for its ChaCha20. Instead this uses primitives already
in the tree — `@noble/curves` secp256k1 ECDH, `@noble/hashes` HKDF — plus
AES-256-GCM from the platform's own WebCrypto. **Zero new dependencies.**

### Key model — what the browser can and cannot do

The browser holds the owner's pubkey (via NIP-07 login) and the Kami **public**
key (hardcoded). It can **seal** but it cannot **decrypt** the backlog: NIP-07
does not expose the owner's private key, and the Kami private key is off-box.

Consequences, accepted for v0.2.634:

- The in-browser emakake rack shows the **current session's** notes (pending +
  just-hung this session). After a page reload, the rack starts empty — the
  backlog is on disk, sealed.
- The sealed backlog is read back by a **node-side tool** (`tools/kami-read.mjs`)
  run on a trusted machine that holds the Kami private key. It decrypts each ema
  record and, optionally, each screenshot to `<id>.jpg`.

This matches the owner's workflow: make many notes live during a playtest, hang
them once; review the sealed backlog later (or hand it to an agent). The notes
survive across sessions on the VPS disk; only the in-memory working set is
session-scoped.

### Owner gate — UX, not security

`installKamiMode` installs the hotkey + mouse tracker unconditionally (inert).
The owner check is **lazy**: on the first capture, the instance capability is
fetched (the public `/mp/admin/update-capability` endpoint) and the logged-in
pubkey is compared to `cap.adminPubkey`. Non-owners see "KAMI: OWNER ONLY" and
nothing is ever sealed or sent.

This is a UX gate, not a security boundary. The server independently admin-gates
the POST route via `adminFromRequest(req)` (fail-closed bearer-token check), and
nothing in the client is trusted.

## Modules

| Module | Responsibility | Tested |
|---|---|---|
| `src/engine/kami/kamiSeal.js` | Sealed-box crypto (ECDH+HKDF+AES-GCM) | 14 tests |
| `src/engine/kami/emaModel.js` | Record shape, tray rules, lifecycle, cull policy | 21 tests |
| `src/engine/kami/uiTarget.js` | Pointer → DOM control description | (via capture) |
| `src/engine/kami/emakakePanel.js` | Rack list render (one DOM writer, textContent-only) | (via render) |
| `src/engine/kami/kamiMode.js` | Browser glue: hotkey, capture, seal+POST, tray | (round-trip) |
| `server/kami/kamiStore.js` | On-disk JSONL + shot ring buffer | 8 tests |
| `server/kami/kamiRoute.js` | Batch validation + store loop (pure) | 4 tests |
| `tools/kami-read.mjs` | Node-side decrypt of sealed backlog | (round-trip) |
| `src/engine/kami/` tests | — | 47 tests |

## Threat model

- **Protects:** data at rest. Root on the VPS, a leaked backup, or a snapshotted
  disk yields unreadable blobs, screenshots included.
- **Does NOT protect:** a live compromise of the delivery pipeline. Whoever can
  patch the JS that nginx serves can capture notes BEFORE they are sealed. No
  server-side storage scheme can defend against that.
- **Does NOT authenticate** the sender. Sealing needs only public keys, so anyone
  holding them can forge an ema. The POST route is separately admin-gated by
  session token. Do not treat a sealed ema as proof of origin.

## Future

- Hooking the capability up to people's own AI bots via Routstr or Continuum is
  one more recipient entry, not a format change (the recipients list is by
  design).
- An in-world rack that renders ema as 3D plaques at their pinned positions
  ("ship to players as world-building") is deferred; v0.2.634 ships the panel
  beside the chat and the pause-modal button.

## Spelling correction (ADR-0033, 2026-08-23)

This document's original text spells the rack "emakake." Confirmed against
Japanese-language sources: the correct romanization is **emagake** (絵馬掛け,
rendaku k→g). Left as-written above for the historical record; see ADR-0033
for the rename applied across code, DOM IDs, and docs.
