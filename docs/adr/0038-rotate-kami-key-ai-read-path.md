# ADR-0038: Rotate the Kami Key + Wire the AI Read Path

- **Status:** Accepted
- **Date:** 2026-08-23
- **Deciders:** chiefmonkey
- **Related:** ADR-0025 (sealed ema), `tools/kami-read.mjs`, `src/engine/kami/kamiSeal.js`, `src/engine/kami/kamiMode.js`

## Context

ADR-0025 sealed every ema to `[ownerPub, KAMI_PUBKEY]`, where `KAMI_PUBKEY`
(`f69bbd44…`) was hardcoded. Its private half was meant to "live off-box" on a
trusted machine that runs `tools/kami-read.mjs` to decrypt the backlog.

Two problems surfaced when wiring the AI agent to read ema:

1. **The Kami private key does not exist anywhere.** No keygen was ever run; the
   pubkey was hardcoded with no record of the private half. Not in the repo, not
   on the VPS (`/etc`, `/var/lib`, `/opt`, systemctl env all checked). Without it,
   no ema — past or future — can ever be decrypted.
2. **The VPS ema store is empty.** `/var/lib/torii-quest/kami` exists (mode 700,
   owned `torii-quest`) but holds no `ema.jsonl` / `shots/`. Writing requires the
   admin session token (the POST `/mp/kami/ema` route is admin-gated, fail-closed),
   so emas dropped in earlier testing were sealed in-browser but never persisted.

## Decision

**Rotate to a fresh Kami keypair** — zero data loss, since the store is empty.

- New tool `tools/kami-keygen.mjs` generates a secp256k1 keypair using ONLY
  Node's built-in `node:crypto` (no npm deps), so it runs on any machine with Node.
  It self-verifies the keypair with a `sealTo`/`openSealed` round-trip (proving
  compatibility with kamiSeal where `@noble/curves` is present), writes the private
  key to `kami-priv.hex` (chmod 600), and **never prints the private key** — only
  the public key, which the owner pastes back to be deployed in `kamiMode.js`.

- **Private key handling.** The owner generates the key themselves (the private
  half never enters the agent's transcript). It is kept off-box (password manager
  / local machine); the VPS only ever held ciphertext. To let the AI agent read
  ema, the owner enters the private key once into the platform's secure
  credential store (never pasted in chat); the agent references it by handle when
  running `kami-read.mjs`. This treats the agent sandbox as the "trusted machine"
  ADR-0025 anticipated.

- **Read loop.** Agent scp's the VPS kami dir (`ema.jsonl` + `shots/`) to the
  sandbox, runs `KAMI_PRIV=<from-credential> node tools/kami-read.mjs`, decrypts,
  and reads the ema (note text + screenshot + ToriiDebug snapshot) to act on it.

## Consequences

- Positive: the AI agent can now read the owner's sealed ema notes — the
  "situated notes + AI action" loop the kami-mode concept intended becomes real.
- Positive: a lost/compromised Kami key can be rotated by re-running the keygen
  and redeploying the pubkey; old emas sealed to the retired key become
  unreadable (acceptable — the key is a long-lived operator secret, rotation is a
  manual event).
- Negative: the AI agent holding the Kami private key means a compromised agent
  session could decrypt all ema. Mitigated by the credential store (key never in
  chat/logs) and by the fact that ema are maintainer notes, not user secrets.
- Open: confirm the admin-gated POST route actually persists when an admin writes
  an ema in-game (smoke-test once the new pubkey is deployed).
