# MP-2 — Server-authoritative hit resolution (same wire)

**Version target:** v0.2.364-alpha
**Branch:** `mp-2-server-authoritative-hits-v0.2.364-alpha`
**Baseline:** v0.2.363-alpha @ `f9ca447` (MP-1 shipped on `main`)
**Status:** SPEC — awaiting user sign-off, no code yet
**Owner track:** graduates `server/arena-ws.js` from advisory relay to authoritative combat arbiter.

---

## 1. Goal

Move hit determination out of the shooter's browser and into `server/arena-ws.js`, using the exact wire protocol shipped in MP-1. A cheating client can no longer claim damage it did not deal; a lagging client can no longer refuse damage it did take.

The wire (`PROTOCOL_VERSION = 1`) does **not** change. The interpretation of a client `HIT` message flips: MP-1 relays it untouched, MP-2 discards the client's `dmg`/`zone` claim and computes its own from the shooter's `SHOT` ray and the server-side avatar collider state.

## 2. What is (and isn't) in scope

**In scope**
- Server-side lightweight collider model: capsule per-peer + head sphere per-peer, positioned from the last authoritative `MOVE` snapshot for each session
- Server-side ray-vs-capsule/sphere intersection for every incoming `SHOT`
- Per-shooter/per-victim damage arbitration (server issues the canonical `HIT`; client `HIT` messages become advisory input that seeds the shot-to-target association)
- HP/kill bookkeeping on the server; `KILL` events emitted by the server, not the victim
- Lag compensation window: server rewinds each peer's snapshot buffer to `SHOT.ts` (bounded, capped at 300 ms) before intersecting
- New env vars: `LAG_COMP_MS`, `SHOT_MAX_RATE`, `HP_MAX`, `RESPAWN_MS`
- Same `MP_ENABLED = false` shipped default — zero behaviour change until the operator flips
- ~25 new tests, plus MP-1's advisory-mode tests kept green under an `MP_MODE=advisory` legacy flag
- `VPS_INSTALL.md §16` addendum: no config change required for existing operators (advisory→authoritative is a server-side upgrade), but note the new env vars

**Not in scope (deferred)**
- Binary wire protocol (still MP-1.5)
- Multi-room / matchmaking (MP-1.5)
- Prize leaderboards / ranked play → MP-3 with NIP-60 eCash stakes
- Server-side physics for movement (still client-authoritative — only combat resolution moves)
- Anti-cheat on movement (teleport / speed-hack rejection) → MP-2.5 hardening pass
- WebRTC P2P transport → MP-3 or later

## 3. Model — server-authoritative

Recap of the flip:

**MP-1 (shipped)**: Client raycasts, decides hit, sends `HIT{targetId, dmg, zone}`. Server relays untouched. Victim's client applies damage.

**MP-2**: Client still raycasts locally for muzzle feel / tracer / hit-marker, but the outcome is provisional. Server independently intersects the shooter's `SHOT` ray against every other peer's server-side capsule/head sphere (rewound to `SHOT.ts` within the lag-comp window) and emits the canonical `HIT`. The victim's client applies damage **only when the server's `HIT` arrives with its own session id as `targetId`**.

The shooter's client hit-marker/audio should be tentative — a soft muzzle cue on local resolution, a definitive "kill confirmed" chime when the server's `KILL` comes back.

## 4. Wire protocol — unchanged

`wireProtocol.js` `PROTOCOL_VERSION` stays at `1`. Every message shape from MP-1 is byte-identical.

What changes is **which side originates** which messages:

| Message | MP-1 origin | MP-2 origin | Notes |
|---|---|---|---|
| `MOVE` | Client | Client | Unchanged. Server records to snapshot ring. |
| `SHOT` | Client | Client | Unchanged. Server now uses it to compute hits. |
| `HIT`  | Client | **Server** | Client `HIT` messages are still validated + rate-limited but no longer relayed. Server emits its own `HIT`. |
| `KILL` | Client | **Server** | Server emits when victim HP ≤ 0. |

An MP-1 client talking to an MP-2 server keeps working: the server ignores the client's `HIT` claim and emits its own; the client's damage code was already gated on receiving a `HIT` from the wire. No client-side change is strictly required for correctness, but MP-2 clients should stop emitting client `HIT` (harmless, but wasted bandwidth). Version 1 stays.

## 5. Architecture

```
Browser (client)                              Operator's VPS
+-------------------------------+              +-----------------------------------+
| Torii Quest bundle            |  SHOT+MOVE   | arena-ws.js                       |
|  - client raycast (tentative) | ───────────► |   snapshotRing[sid] (ring buf)    |
|  - hit-marker (soft, local)   |              |   combat/serverHitResolver.js     |
|  - HP applied on server HIT   | ◄─────────── |     rewind(t) → capsules[]        |
|                               |  HIT+KILL    |     rayVsCapsules(shot,caps)      |
+-------------------------------+  (server)    |   hpTable[sid], respawnTimer[sid] |
                                               +-----------------------------------+
```

Single origin. Same Caddy `/mp` block. Same `wss://<domain>/mp`. No new external dependencies (no Rapier on the server — the intersection is analytic capsule/sphere math, ~120 lines pure JS).

## 6. Server modules

All new server code goes under `server/`. All node-pure (no `ws` import), except the top-level `arena-ws.js` wiring.

| Module | Responsibility | ~Lines |
|---|---|---|
| `server/combat/snapshotRing.js` | Pure. Ring buffer of `{ts, pos, rot, vel}` per session. `push(t, snap)`, `sampleAt(t)` returns the snapshot ≤ t (or interpolates between two flanking snaps). Capacity = 30 (≥1.5 s at 20 Hz). | ~90 |
| `server/combat/capsuleModel.js` | Pure. Given a snapshot, produce `{ bodyCap: {p0,p1,r}, headSphere: {c,r} }`. Constants: body height 1.8 m, radius 0.35 m, head radius 0.20 m, head centre offset +1.55 (matches shipped client `BOT_HEAD_CENTRE_Y_OFFSET`). | ~60 |
| `server/combat/rayVsCapsule.js` | Pure. Analytic ray-vs-capsule and ray-vs-sphere. Returns nearest hit + zone (`"head"` if sphere hit, `"body"` if cap hit, `"limb"` if cap hit but outside a "core" fraction). | ~140 |
| `server/combat/hitResolver.js` | Pure. `resolveShot({shooterId, shot, sessions, snapshotRings}) → HIT[]`. Iterates other sessions, rewinds each to `shot.ts` (clamped ≤ `LAG_COMP_MS`), builds capsule, casts ray, returns 0 or 1 `HIT` (nearest peer only — no penetration). | ~120 |
| `server/combat/damageTable.js` | Pure. `damageFor(zone, weapon) → number`. Matches client `engine/combat/damage.js` values: head 100, body 34, limb 20. Single source of truth mirrored (import-copy at build time — see §11). | ~30 |
| `server/combat/hpLedger.js` | Pure. `applyDamage(sid, dmg) → {hpAfter, killed}`. `respawn(sid)` resets HP. `HP_MAX` default 100. | ~60 |

`arena-ws.js` grows by ~50 lines: it wires `snapshotRing.push()` on every accepted `MOVE`, calls `hitResolver.resolveShot()` on every accepted `SHOT`, applies `hpLedger`, and emits the resulting `HIT`/`KILL` via the existing `broadcastToOthers` (with a new `broadcastToAll` for `HIT`/`KILL` since the shooter needs to see the definitive result).

## 7. Lag compensation

- Every session's `snapshotRing` retains the last 30 `MOVE`s (~1.5 s at the shipped 20 Hz `MOVE` rate).
- On `SHOT{ts}`, the server clamps `t = max(shot.ts, now - LAG_COMP_MS)` where `LAG_COMP_MS = 300` (env-tunable).
- For each other peer, `snapshotRing.sampleAt(t)` returns the snapshot at that time. If the ring is empty for that peer (they connected < 300 ms ago), skip them.
- Interpolation between two flanking snaps is linear on `pos`, slerped on `rot` (via a pure quaternion utility — no THREE dependency; simple 4-component slerp).

Rationale: 300 ms covers most transatlantic RTTs plus one `MOVE` interval, without letting a stale shooter "shoot around corners" more than a snapshot's worth.

Client-side prediction / smoothing is unchanged from MP-1 (`positionSync.js` still runs on the receive side).

## 8. HP + respawn

- `HP_MAX = 100` (env)
- Server applies damage from `damageTable.damageFor(zone, weapon)`. Head 100 (one-shot), body 34, limb 20 — same as the shipped client `damage.js`.
- On `hpAfter ≤ 0`, server emits `KILL{shooterId, victimId, weapon}` to all peers (including victim + shooter) and schedules a respawn after `RESPAWN_MS` (default 3000).
- On respawn, server sets `hp = HP_MAX`, picks a spawn point from a small pool (initial pool: 4 spawn points mirroring the client `spawnPoints` array in `player.js`), and emits a `MOVE` on the peer's behalf so other peers see them warp. Actual client-side warp is driven by a new `RESPAWN` message → see §9.

## 9. Wire protocol — one additive (backwards-compatible) message

`RESPAWN` is added. **This is a purely-additive change**, not a shape change to any existing message, so `PROTOCOL_VERSION` stays at `1`. Older MP-1 clients that ignore unknown types (as the shipped `decode()` does — it returns `fail('UNKNOWN_TYPE', ...)` and drops the message) simply skip it; the practical effect is they'll see the peer stay dead until their next `MOVE` arrives, which is acceptable.

| Direction | Type | Payload | Notes |
|---|---|---|---|
| S → target only | `RESPAWN` | `{ pos, rot, hp }` | Sent to the victim's own client after `RESPAWN_MS`. Victim's client warps + heals. Server also emits a synthetic `MOVE` to all others so remote avatars update. |

`RESPAWN` validation, sanitization, and `MSG` constant get added to `wireProtocol.js`. `ALLOWED_FIELDS[MSG.RESPAWN] = ['pos', 'rot', 'hp']`.

**No other wire change.** `SHOT`/`HIT`/`KILL` shapes are byte-identical to MP-1.

## 10. Client-side changes (minimal)

Client code changes are small and mostly deletions:

| File | Change |
|---|---|
| `src/engine/multiplayer/multiplayerHost.js` | On local player shot, still emit `SHOT`. **Stop emitting client `HIT`.** Kept `emitHit()` as a no-op export for regression compat. |
| `src/engine/multiplayer/remoteAvatars.js` | On server `HIT` where `targetId === selfId`, apply damage locally (unchanged from MP-1's client-hit flow, just the origin is now the wire). |
| `src/engine/multiplayer/wsClient.js` | Add `RESPAWN` handler → fires `EV.MP_RESPAWN` on the bus. |
| `src/main.js` | New `EV.MP_RESPAWN` subscriber: warp player, reset HP HUD. |
| `src/engine/multiplayer/wireProtocol.js` | Copy of server's added `RESPAWN` type/validator (shared module — one edit lands in both). |

`multiplayerHost.js` gains no new hot-path allocations. The double-gate (`MP_ENABLED` at both `arenaRuntime.js` and `multiplayerHost.js`) is unchanged.

## 11. Damage table — single source of truth

The client's `engine/combat/damage.js` and the server's `server/combat/damageTable.js` must not drift. Options considered:

1. **Import shared module** — server imports `../../src/engine/combat/damage.js`. Rejected: pulls the client tree into the server surface area.
2. **Copy + tests-agree** ✅ — server has its own module, and a new test `tests/multiplayer/damage-table-parity.test.js` imports BOTH and asserts field-for-field equality. Fails CI if they drift.

Chosen: option 2.

## 12. Tests (~25)

All under `tests/multiplayer/`. Node-safe, fixture-driven.

| File | Cases | Focus |
|---|---|---|
| `snapshot-ring.test.js` | 5 | push/sampleAt; interpolation between snaps; empty-ring case; capacity eviction |
| `capsule-model.test.js` | 4 | Snapshot → capsule dimensions; head sphere position tracks rot Y; edge cases (zero rot, near-limits pos) |
| `ray-vs-capsule.test.js` | 8 | Hit vs. miss for capsule + sphere; nearest of two peers; head-before-body when both intersect; grazing shots return "limb"; behind-shooter ray returns no hit |
| `hit-resolver.test.js` | 5 | Full `resolveShot` with 3 fake peers; lag comp bounds; empty-ring peers skipped; damage-table wired |
| `damage-table-parity.test.js` | 1 | Server ↔ client `damage.js` values identical |
| `hp-ledger.test.js` | 3 | applyDamage / KO / respawn-heals / negative damage rejected |
| `mp2-integration.test.js` | 3 | Fake ws: MOVE→SHOT round-trip yields server-issued HIT; client HIT is dropped, not relayed; RESPAWN delivered only to victim + synthetic MOVE to others |
| `regression-mp1-compat.test.js` | 2 | Legacy `MP_MODE=advisory` (env-set) still relays client HIT untouched; shipped MP-1 tests pass under legacy mode |

Regression checks (`tools/regression-check.mjs`):
- **New check**: Forbid `client-authoritative HIT` — grep server code for `broadcastToOthers.*HIT` — must NOT match (only `broadcastToAll` on the server-issued HIT is allowed).
- **New check**: `damageTable.js` values match `damage.js` (build-time script that runs the parity test as a pre-check).

Total post-MP-2: ~2155 → ~2180 passing tests.

## 13. Env / config additions

New env vars (all optional, sane defaults):

| Var | Default | Purpose |
|---|---|---|
| `LAG_COMP_MS` | `300` | Max rewind window for lag comp. Clamps `shot.ts` to `now - LAG_COMP_MS`. |
| `HP_MAX` | `100` | Peer max HP. |
| `RESPAWN_MS` | `3000` | Delay from KILL to RESPAWN emission. |
| `MP_MODE` | `authoritative` | `authoritative` (default) or `advisory` (MP-1 legacy behaviour). Kept for one release. |

`SHOT_MAX_RATE` and `MOVE_MAX_RATE` remain from MP-1 (`RATE.SHOT = 20`, `RATE.MOVE = 25`).

No new client-side config. `MP_ENABLED` still controls the whole subsystem.

## 14. Deployment — no operator changes required

`VPS_INSTALL.md §16` already assumes operators run `git pull && systemctl restart torii-arena-ws`. MP-2 keeps:
- Same Caddy `/mp` block
- Same systemd unit
- Same `wss://<domain>/mp` origin
- Same static bundle (no client-side redeploy strictly required for existing MP-1 clients to interoperate — they'll just receive `RESPAWN` as unknown and skip it, meaning they won't warp until their next MOVE arrives)

Operators upgrading get an addendum note in `VPS_INSTALL.md §16`:

> **MP-2 upgrade note (v0.2.364-alpha):** Combat is now server-authoritative. No config change required. Optional env vars: `LAG_COMP_MS=300`, `HP_MAX=100`, `RESPAWN_MS=3000`. Rollback to MP-1 behaviour: set `MP_MODE=advisory` in the systemd unit.

## 15. Version markers (bump list)

- `src/config.js` `VERSION → 'v0.2.364-alpha'`; `MP_ENABLED` stays `false`
- `index.html` `#version-label`, `#ver`, `<meta name="version">`
- `package.json` `"version": "0.2.364-alpha"`
- `tools/regression-check.mjs` header + `EXPECTED_VERSION` + stale-version regex flags v0.2.363
- `src/engine/dashboard/toriiQuestDashboardData.js` — `TORII_QUEST_VERSION`, "Source version" row, "Tests" row (target: 2155 + ~25 = ~2180 passing; files 144 → ~150)
- `public/sw.js` `CACHE_VERSION = 'tq-v0.2.364-alpha'`
- `MVP_APPROVAL_STATE.json` (regenerated via `npm run approval:state -- --write`)
- `NEXT_ACTION_STATE.json` (regenerated via `node tools/next-action-state.mjs --write`)
- `torii-quest-{strategy,todo,progress,handoff}.md` "Current version" lines

## 16. Definition of Done

- All ~25 new tests pass; full suite green (~2180)
- `npm run check` clean (18/18 regression checks — MP-1's 16 + `HIT-source` + `damage-parity`)
- `npm run release:status` verdict `READY`
- With `MP_ENABLED=false` (shipped default), zero behaviour change vs v0.2.363 — single-player identical
- With `MP_ENABLED=true` on a dev host running `arena-ws.js` locally:
  - Two browser tabs see each other; shooting emits server-issued HIT; damage applied on wire receipt only
  - Client HIT emission removed (grep confirms); killed player receives RESPAWN and warps
  - Lag comp verified with an artificial 200 ms latency injector (dev-only)
  - `MP_MODE=advisory` env flip restores MP-1 behaviour byte-for-byte
- Docs updated: strategy MP-2 line flips from "next slice" to "shipped"; todo shows MP-2 shipped, MP-3 spec queued (eCash stakes + prize leaderboards); progress adds MP-2 entry; handoff §1 updated
- PR squash-merged onto `main`
- Preview deploy validated; user decides whether to publish

---

## Sign-off gate

Before ANY code is written, this spec is committed to the branch and shown to the user. The user acks:
- Scope (§2)
- Server-authoritative model (§3)
- Lag comp window (§7)
- Additive `RESPAWN` message (§9) — protocol version stays at 1
- Damage-table parity strategy (§11)
- Test coverage (§12)
- No operator-config change (§14)

Only then does implementation begin.

---

## Appendix A — Rejected alternatives

- **Bump `PROTOCOL_VERSION` to 2.** Rejected: no existing message shape changes; `RESPAWN` is purely additive; MP-1 clients ignore unknown types cleanly. Bumping would force a coordinated operator + client redeploy for no correctness benefit.
- **Run Rapier on the server.** Rejected: adds ~2 MB of native deps for a static-site-adjacent Node process. Analytic capsule/sphere math is ~150 lines pure JS and handles our shooter's needs (no penetration, no ricochets, no soft bodies). Revisit if MP-3 needs terrain-aware physics arbitration.
- **Client-authoritative HIT with server sanity check ("is this even plausible?").** Rejected: doesn't fix the trust problem, just narrows the cheat window. Once we do the work to compute plausibility we're 90% of the way to full authority.
- **Snapshot at every physics tick.** Rejected: 20 Hz `MOVE` is the current shipped rate. Interpolating between the two flanking snaps gives sub-frame accuracy without a rate change. If shooter feel demands it, `MOVE` rate can be raised in MP-2.5 without a wire change.
