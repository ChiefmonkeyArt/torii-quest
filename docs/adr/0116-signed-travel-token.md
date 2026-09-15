# ADR-0116: Signed travel token (no re-login across a torii gate)

- **Status:** Accepted
- **Date:** 2026-09-15
- **Version:** v0.2.847-alpha
- **Deciders:** chiefmonkey
- **Related:** ADR-0114 (seamless single-domain travel — Option B bridge), ADR-0115 (single-instance npub session), `server/auth/sessionTokens.js`, `server/auth/travelToken.js`, `src/engine/gateway/travelToken.js`, `src/engine/gateway/openVisit.js`

## Context

The open-visit hop identifies an arriving player with an **unsigned** `?torii-traveller=<hex64>` query param (ADR-0114's `buildVisitUrl`). The destination cannot trust an unverified pubkey (anyone can append it), so today the traveller must re-approve a **fresh NIP-07 sign-in in the new world** — the exact "re-login" friction the seamless-travel vision (ADR-0114 item 2/3) sets out to remove.

We need a way for the **origin** world (where the player's NIP-07 signer is already active) to prove to the **destination** world — cryptographically, and without a second prompt — that the arriving session *is* a given npub. The token must be spoof-proof, replay-bounded, and cheap to verify on the sovereign model (no shared trust root between independently-operated worlds).

## Decision

Carry a **signed, short-lived, single-use NIP-98 (kind:27235) "travel" event** — signed once by the traveller's NIP-07 signer *in the origin world* — and verify it on the destination before auto-seating the session.

**Event shape** (signed → adds `id`, `pubkey`, `sig`):

```json
{
  "kind": 27235,
  "created_at": 1757934400,
  "content": "",
  "tags": [
    ["u", "https://<destination-origin>/mp/travel"],   // audience: who it is for
    ["t", "travel"],                                    // action verb
    ["expiration", "1757934700"]                        // NIP-40 TTL (5 min)
  ]
}
```

**Verification (destination server, `server/auth/travelToken.js`)** — fail-closed, in
order:

1. `kind === 27235`, `pubkey` is hex64, `tags` present.
2. `u` tag equals the **canonical travel audience** (explicit `TRAVEL_AUDIENCE_URL`,
   else `QUEST_PUBLIC_URL` origin + `/mp/travel`) — never a forwarded Host header.
3. `t` tag equals `travel`.
4. `expiration` (NIP-40) present and `> now`.
5. `created_at` finite and within a **symmetric clock-skew window** (±300 s).
6. Schnorr `verifyNostrEventSig` holds (id binds content, sig verifies under pubkey).
7. `event.id` is **single-use** — a bounded consumed-ids map rejects replays.

On success the server reuses the existing `sessionTokens.issueToken(pubkey)` and the
client reuses the existing `AUTH_TOKEN` WS path — so the whole "1 sign, 0 re-signs"
machinery (ADR/sessionTokens v0.2.375) is untouched.

**Anti-replay** differs from login deliberately: login binds to a fresh server-issued
`challenge`; travel is signed in a *different* browser context and can't await one, so
it uses **NIP-40 short TTL + single-use event.id** instead.

**Carriage** (ADR-0114 Option B, next slice): the destination world is opened in a
fullscreen same-tab iframe and the signed event is delivered via `postMessage`
(`?torii-traveller=` remains as the identity *hint* / fallback, not the trust). The
address bar stays on the player's own domain.

## Consequences

- Arriving travellers authenticate with **zero** NIP-07 prompt in the destination:
  one sign in the origin, verified handoff, then a normal session token.
- The token is bound to a specific destination (audience) and expires in ≤ 5 minutes,
  so a captured token is both non-portable across worlds and replay-bounded on one.
- The server carries no new trust root: it verifies the *traveller's own* signature,
  so any self-hosted world can accept travellers without a shared authority.
- `/mp/travel` is served by the existing `/mp/*` proxy handle — no new routing.
- This is the trust primitive only; the iframe + `postMessage` carriage and the
  spawn-at-gate arrival (ADR-0114 "shop door bell") land in a following slice.