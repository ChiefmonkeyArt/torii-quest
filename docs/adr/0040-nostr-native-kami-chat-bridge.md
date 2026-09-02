# ADR-0040 — Nostr-native Kami chat bridge (staged)

Date: 2026-08-24
Status: Accepted (Stage 1 shipped v0.2.659-alpha; VPS key custody + extension-driven signing deferred)
Supersedes (comms path only): the plaintext `replies.jsonl` channel from ADR-0039
remains as the in-game fallback; it is NOT retired by this ADR.

## Context

ADR-0039 shipped 2-way ema comms as a custom `replies.jsonl` append-only file +
an admin-gated `GET /mp/kami/replies?since=<ts>` HTTP route + 5s browser polling.
The replies are **plaintext** because the browser cannot decrypt a `kamiSeal`
envelope: NIP-07 (`window.nostr`) exposes only `getPublicKey` + `signEvent`, and
`kamiSeal` is custom ECDH+HKDF+AES-GCM (ADR-0025) — not NIP-04/NIP-44 — so there
is no `window.nostr.decrypt` path for it.

The owner asked whether the comms could instead be **native Nostr**, readable in
a regular Nostr client such as Block's **Buzz** — i.e. Kami operating as a real
Nostr agent identity (an npub signing events on a relay), in the spirit of
gzuuus's DVMCP (Data Vending Machine + MCP bridge) and Buzz's "agents and
humans are equal cryptographic identities" model.

## Decision

Build a **staged Nostr bridge**: Kami publishes replies as standard **NIP-17
gift-wrapped direct messages** (`kind:1059`) to the owner's npub, in addition
to (not instead of) the existing in-game `replies.jsonl` path. NIP-17 is chosen
because Buzz's own `NOSTR.md` declares NIP-17 (`kind:1059`) **supported** while
NIP-04 and NIP-44 are **not implemented** as standalone formats in Buzz — NIP-17
is the one standard, modern private-DM format that Buzz (and Amethyst, Nostir,
etc.) will render as a chat.

### Why NIP-17 gift-wrap specifically

NIP-17 wraps a message in three layers:
1. **Rumor** — an unsigned event `{kind, content, tags, created_at}`.
2. **Seal** — the rumor NIP-44-encrypted to the recipient, signed by the
   **sender's real key** (Kami's `kami-priv`).
3. **Gift wrap** (`kind:1059`) — the seal NIP-44-encrypted to the recipient,
   signed by an **ephemeral throwaway key**, with a `#p` tag for the recipient.

This is exactly what makes Kami an "agent identity" without exposing its
long-term key on every message: the outer wrap reveals only an ephemeral key +
the recipient tag. The recipient (the owner) unwraps with their own private key.

Crucially, **Kami only needs the owner's public npub to publish** — it never
needs the owner's private key. NIP-44 (XChaCha20-Poly1305) is performed in Node
via `nostr-tools` (`nip44.encrypt`/`nip17.wrapEvent`), where there is no NIP-07
constraint. The signing key (`kami-priv.hex`, ADR-0038) currently lives OFF-BOX
in a trusted sandbox only; it is NOT on the VPS. Stage 1's tool signs when run
from a trusted machine holding the key — see § Key custody (deferred) below.

### The browser still cannot decrypt NIP-17

This is the corrected premise (the original ADR-0040 draft wrongly assumed the
browser could decrypt NIP-44 via `window.nostr`). NIP-07 hides the owner's
private key inside the extension, so the browser cannot perform the ECDH needed
to unwrap NIP-44 — **unless** the extension exposes `window.nostr.nip44`
(`nip44.encrypt`/`nip44.decrypt`), which most NIP-07 extensions do **not**.
Therefore the in-game emagake rack **cannot** render NIP-17 DMs directly and
keeps the ADR-0039 `replies.jsonl` + HTTP poll path unchanged. Each Kami reply is
**dual-written**: appended to `replies.jsonl` (in-game rack) AND published as a
NIP-17 DM to the relay (Buzz / any NIP-17 client).

## Stage 1 (this build) — outbound dual-write

- **`tools/kami-nostr-reply.mjs`** — VPS tool, run as the `torii-quest` user
  (same as `tools/kami-reply.mjs`). Reads reply text from `--text-file`/stdin
  (never shell-quoted), validates + caps (text ≤ 2000 chars, matching
  ADR-0039). Derives the Kami npub from `KAMI_PRIV`. Creates a NIP-17 private
  direct-message rumor (`kind:14`, content = the reply text), gift-wraps it via
  `nip17.wrapEvent(kamiPriv, { publicKey: ownerPubHex }, message)` → outer
  `kind:1059` signed by an EPHEMERAL key, `#p` tag = owner pubkey, and publishes
  the `kind:1059` to the relay set. The inner rumor's sender pubkey is Kami's
  real npub; the outer signer is always ephemeral. **Dual-writes**: also appends
  to `replies.jsonl` via the existing `makeReplyStore`, so the in-game emagake
  rack is unchanged.
- **`src/engine/kami/kamiNostrCap.js`** — pure browser feature-detection:
  `hasNip07`, `hasNip04`, `hasNip44` (checks `window.nostr` and its
  `nip04`/`nip44` sub-objects). Foundation for a future in-game decrypt path;
  not yet wired into the rack (gated on extension support, which is not
  assumed).
- Tests: NIP-17 round-trip (wrap with Kami key + a test recipient key →
  `unwrapEvent` → content matches; wrong-recipient key fails); capability
  detection branches; dual-write to `replies.jsonl`.
- **No change** to the in-game emagake rack, `kamiMode.js` polling, or the
  `GET /mp/kami/replies` route.

## Stage 2 (future ADR) — inbound + always-on

True 2-way "chat with Kami through Buzz" needs the owner to DM Kami's npub from
Buzz, and Kami to read it. That requires an always-on VPS process (daemon or
scheduled task) that subscribes to `kind:1059` addressed to Kami's npub,
unwraps with `kami-priv`, and generates a reply. This is sovereign-bot territory
(see knowledge-wiki `concepts/torii-sovereign-bot-genesis`) and is explicitly
deferred — Stage 1 proves the outbound wire and the NIP-17 crypto first.

## Key custody (deferred)

`kami-priv.hex` is NOT installed on the VPS. The owner reviewed the tradeoff
(2026-08-24) and chose to defer putting a private key on the server. Findings:

- **Without the key on the VPS, nothing current breaks.** The in-game emagake
  rack (ADR-0039 plaintext `replies.jsonl` + HTTP poll) needs no key. Reading ema,
  creating tasks, and managing milestones are unrelated to `kami-priv` (it is a
  pure crypto key for NIP-17 signing + ema decryption). Ema decryption can run
  from the trusted sandbox that already holds the key.
- **What the key gates** (all deferrable): (1) autonomous VPS-side NIP-17
  signing; (2) ema decryption server-side; (3) Stage 2 inbound unwrapping of
  owner→Kami DMs.
- **Buzz / Nostr-client DMs still work without it**: outbound Kami DMs are
  published from the trusted sandbox (smoke-proven: 3/4 relays accepted); the
  owner reads them in Buzz with their OWN identity (no `kami-priv` involved).
  Inbound (owner→Kami via Buzz) lands on relays and can be unwrapped on demand
  from the sandbox; only the always-on real-time listener is missing (Stage 2).

### Future custody option — Plebeian Signer (NIP-07 extension)

When Nostr-native DMs are revisited, the preferred path is the **Plebeian
Signer** browser extension rather than a raw key on the VPS:

- It is a NIP-07 (`window.nostr`) signer with full `signEvent` + **NIP-04/NIP-44
  encrypt/decrypt** support — exactly the primitives a NIP-17 gift-wrap needs.
- Load Kami's identity into the extension; the in-game rack signs DMs as Kami
  in-browser via `signEvent` (inner rumor + seal) + `nip44.encrypt` (encryption
  layers); the browser generates the ephemeral outer wrap itself (no key needed).
- `kami-priv` stays in the extension vault on the owner's own machine — never
  the VPS.
- `src/engine/kami/kamiNostrCap.js` (built this session) already feature-detects
  `nip07`/`nip04`/`nip44` for exactly this path. The extension-driven signing
  itself is NOT yet wired up — it is the future build.

**Tradeoff**: NIP-07 signing is interactive (the owner approves each sign in the
extension popup), so this is NOT autonomous. For autonomous always-on Kami
(Stage 2 inbound), a real NIP-46 bunker (nsecBunker / Amber / self-hosted)
holding Kami's key would be needed — a separate, larger build. The Plebeian
Signer is a browser extension, not a NIP-46 bunker the VPS can call remotely.

### Status: DEFERRED. No VPS key install. No extension wiring. Revisit when the
owner returns to Buzz / Nostr-native DMs.

## Consequences

- **No regression risk**: the in-game rack keeps working exactly as in v0.2.656.
  Stage 1 is purely additive (a new VPS tool + an unused-in-rack capability
  module + tests).
- **Buzz interop is real**: Kami's replies appear as NIP-17 DMs in any
  NIP-17-capable client. Verified against Buzz's published NIP support table.
- **Dependency**: adds `nostr-tools` + `undici` (`^7.29.0`) as server-only deps
  (`undici` provides the browser-API-compatible `WebSocket` for the VPS relay
  publish — Node 20 has no global WebSocket; bundled into the arena-ws server
  build + the VPS tool; NOT shipped to the browser bundle — the browser still
  does no NIP-44).
- **Metadata leak**: NIP-17 gift-wrap outer is signed by an ephemeral key, but
  the `#p` recipient tag + timestamps are visible on the relay. Content is
  E2E encrypted. Acceptable for the "banal" comms per ADR-0039.
- **Key reuse**: the ADR-0038 rotated Kami key (`kami-priv.hex`) becomes Kami's
  Nostr identity key directly (it is already a valid secp256k1 scalar). No new
  key ceremony.
