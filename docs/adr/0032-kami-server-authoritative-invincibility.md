# ADR-0032: Kami Mode Invincibility Made Server-Authoritative

- **Status:** Accepted
- **Date:** 2026-08-23
- **Deciders:** chiefmonkey
- **Related:** ADR-0025 (Kami Mode), ADR-0029 (state machine), ADR-0031
  (hotkey), `server/arena-ws.js`, `server/bots/arenaBotSim.js`,
  `src/engine/kami/kamiMode.js`, `src/engine/multiplayer/multiplayerHost.js`,
  `src/engine/multiplayer/wireProtocol.js`

## Context

After the ADR-0031 hotkey fix shipped, the owner reported: "K worked all
good but I was not invincible... bots still shot at me and killed me in
kami mode... ideally I become invincible AND all the bots and augustink
ignore me and go about their game."

Code tracing (per the standing "never guess" rule) found the exact cause.
Kami Mode's invincibility (`kamiInvincible()` in `kamiMode.js`, guarding
`takeDamage()` at `src/player.js:376`) is **purely client-side** — it only
ever protected the single-player local damage path. The live game the
owner tests in is multiplayer, and MP is fully **server-authoritative**:
`server/arena-ws.js` runs its own bot AI simulation
(`server/bots/arenaBotSim.js` wrapping the shared pure
`src/engine/entities/botSim.js`) and independently resolves ALL combat —
bot-vs-player and peer-vs-player alike — with **zero knowledge that Kami
Mode exists**. Setting a local `_invincible` flag the server never sees
changes nothing about whether a bot's server-side raycast lands on the
admin.

Three exact server-side call sites apply damage/kill with no Kami
awareness at all:

1. `onBotShot()` in `arena-ws.js` — the bot AI's ray-cast vs. the nearest
   player.
2. `resolveAndBroadcast()` in `arena-ws.js` — peer/bot shot resolution →
   `applyDamage`.
3. The ~20Hz bot-tick loop's `players` array builder — feeds the bot AI
   its entire target roster every tick.

The server already had everything needed to verify admin identity on its
own: `sess.pubkey` (set at `finishAuth` from the signed Nostr auth event)
and `ADMIN_PUBKEY_HEX` (`npubToHex(process.env.QUEST_ADMIN_NPUB)`,
canonical lowercase hex64) — both already in use for the unrelated
admin-update-capability feature.

Presented with a lighter option (block damage only, bots still shoot at
and visibly react to the admin) vs. the full behavior described above,
the owner chose the full version: **"Full version: ignore + invincible."**

## Decision

Kami Mode invincibility becomes server-verified and server-enforced, with
bots excluded from targeting the admin entirely rather than merely
blocked from damaging them.

1. **New additive wire message `KAMI_STATE`** (client→server):
   `{ t: 'KAMI_STATE', active: boolean }`. No `PROTOCOL_VERSION` bump —
   purely additive, same pattern as other MP-2/MP-3 additions.
2. **The server never trusts the client's claim alone.** `isKamiActive(sess)`
   re-verifies `sess.pubkey.toLowerCase() === ADMIN_PUBKEY_HEX` before ever
   honouring `sess.kamiActive`. A non-admin session sending
   `KAMI_STATE {active:true}` has the flag recorded but `isKamiActive()`
   still returns `false` for it — spoofing the flag does nothing without
   also controlling the admin's signed Nostr identity.
3. **Bot-ignore, not just damage-block:** while active, the admin's
   session is excluded from the bot-tick's per-tick `players` roster
   before it's handed to `arenaBotSim.tick()`. Bots literally cannot
   see/target/aim at the admin — this is the primary "bots ignore you"
   mechanism, and required no change inside `botSim.js` itself.
4. **Two backstop guards** cover paths the roster exclusion does not:
   `onBotShot()`'s ray-cast loop (an in-flight shot resolving in the same
   tick the admin entered Kami) and `resolveAndBroadcast()`'s damage
   application (peer-vs-peer fire, which never goes through the bot
   roster at all).
5. **Reconnect resync:** on the client's `mp_state → CONNECTED` handler,
   if Kami Mode is already active locally, `sendKamiState(true)` fires
   again — a fresh/reconnected server session otherwise has no memory of
   a Kami state that predates the new connection.
6. **Session cleanup is automatic:** `sessions.delete()` on disconnect
   already destroys the whole session object including `kamiActive` — no
   extra teardown code needed.

Client wiring: `multiplayerHost.js` gained `sendKamiState(active)`
following the exact `_send()` pattern as `sendShot`/`sendKill`.
`kamiMode.js`'s `enterKamiMode()` calls it with `true` right after setting
the local `_invincible` flag; `exitKamiMode()` calls it with `false` in
both its early-bail and normal exit paths, so a stray Esc during the
owner-check can't leave the server thinking Kami is still active.

## Consequences

- **Enables:** invincibility and bot-ignore that actually hold in the
  live multiplayer game the owner tests against, not just in a
  single-player code path nothing exercises.
- **Forecloses:** a client can no longer unilaterally decide it is
  invincible — the server is the sole authority, consistent with every
  other MP-2/MP-3 combat decision (hit resolution, damage tables, score).
- **Trade-offs:** the admin becomes literally invisible to bot AI
  targeting while active (not just unhittable) — bots don't turn to face
  or track them. This matches the requested behavior ("bots... go about
  their game") but means a bystander watching a bot fight the admin will
  see the bot behave as if the admin were not there.
- **Enforcement:** `isKamiActive()`'s pubkey re-check is the sole trust
  boundary — every guard site calls it fresh rather than reading
  `sess.kamiActive` directly, so a future call site added without
  routing through it would not be protected (documented in code comments
  at each of the three guard sites). New tests: `KAMI_STATE` validator +
  round-trip + sanitize (`tests/multiplayer/wire-protocol.test.js`);
  `sendKamiState` drop-when-disconnected / correct-frame-when-connected
  (`tests/multiplayer/multiplayer-host.test.js`); client enter/exit call
  sites fire with the correct boolean
  (`tests/kami-state-machine.test.js`). 8 new tests + 3097 full suite
  green.

## Alternatives considered

- **Damage-block only (lighter option), bots still visibly shoot/react.**
  Simpler (a single guard at damage-application time, no roster
  exclusion) but explicitly rejected by the owner in favor of the full
  ignore+invincible behavior.
- **Trust the client's `active` flag directly, no server-side pubkey
  check.** Rejected outright — any connected session could then claim
  `KAMI_STATE {active:true}` and become unkillable/untargetable, a
  trivial cheat vector in a multiplayer arena shooter.
- **Guard only inside `botSim.js`'s target-selection logic instead of
  excluding from the roster upstream.** Would require threading Kami
  awareness into the shared pure sim module (also used server + any
  future client-side prediction), coupling a single-admin,
  single-server-instance concept into general-purpose bot AI. Roster
  exclusion at the call site keeps `botSim.js` unaware and pure.

## Notes

Caught during testing, not guessed: `installKamiMode()` in `kamiMode.js`
explicitly whitelists incoming `deps` keys into its internal `_deps`
object. The new `sendKamiState` dep was silently dropped until it was
added to that whitelist too — without this, `kamiMode.js` would have
called a dep that was always `undefined`, and the entire client-side send
path would have been permanently inert with no error anywhere. The first
version of the new `kami-state-machine.test.js` assertions caught this
immediately (`expect(kamiStateCalls).toEqual([true])` failed with `[]`).
