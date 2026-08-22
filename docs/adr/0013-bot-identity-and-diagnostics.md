# ADR-0013: Bot identity (dwarves) + always-on floating labels + shot diagnostics

- **Status:** Accepted
- **Date:** 2026-08-22
- **Deciders:** chiefmonkey
- **Related:** `src/bots.js`, `src/engine/entities/bot-tactics.js`,
  `server/bots/arenaBotSim.js`, `src/lod.js`,
  ADR-0006 (server-authoritative HIT), ADR-0011 (combat/LOD)

## Context

A reproducible gameplay bug is live: shooting a bot dozens of times
appears to have no effect (no hit-reg, no HP change, no death anim),
then the bot silently disappears without playing the death animation
or entering the intended respawn loop. The intended contract is:
2 body shots OR 1 headshot = kill → death animation plays → bot ceases
to exist → respawn after a short delay.

Diagnosing the bug is hard because:

1. Bots are indistinguishable in logs (`_botById(p.id)` uses opaque
   numeric ids; console output can't be tied to what the player saw).
2. There is no in-world identity — every bot looks the same, so "this
   bot took 12 shots" is not a testable claim.
3. SP (`_tickSP` via local `botSim`) and MP (`_tickNet` interpolating
   server `BOT_STATE`) run different tick paths; the bug's cause may
   be different in each. See ADR-0014 (proposed) for SP↔MP unification.

The wire protocol and server sim already carry a `name` field on
`BOT_STATE` (see `src/bots.js:417`, `server/bots/arenaBotSim.js:113`),
but the client neither renders it nor logs it.

## Decision

Add a **pure diagnostic + identity layer** to bots. Zero gameplay
change; zero collider/HP/death-FSM change. Three parts:

### 1. Deterministic dwarf names

- Introduce a **frozen name pool** in a new module
  `src/engine/entities/botIdentity.js`:
  `['Doc', 'Grumpy', 'Happy', 'Sleepy', 'Bashful', 'Sneezy', 'Dopey']`
  (the seven dwarves, no Snow White).
- Provide `nameForBotId(id) → string` that maps a bot's numeric id
  deterministically to a dwarf name (`pool[id % 7]`). Stable across
  spawns of the same id — a respawned bot keeps its name.
- **Server-side authoritative when MP is on:** `server/bots/arenaBotSim.js`
  populates `st.name = nameForBotId(id)` at bot construction. The client
  reads `pose.name`.
- **Client-side fallback for SP:** where `pose.name` is absent (SP
  offline path), the client computes `nameForBotId(bot.state.id)`
  from the same module — so SP and MP display the same names for the
  same ids.
- The BOSS name (`BOSS_NAME` in `server/bots/arenaBotSim.js`) is
  unchanged — bosses are not in the dwarf pool.

### 2. Always-on floating name labels

- Every live bot renders a **world-space text label** above its head
  bearing its dwarf name.
- Implementation: one `THREE.Sprite` (or CSS2DObject) per bot,
  parented under `bot.model.root` at a height slightly above the
  head sphere. Uses an existing text-to-canvas helper if available,
  otherwise a new tiny helper `src/engine/ui/floatingLabel.js`.
- **Always visible** while `bot.state.alive === true`. Hidden when
  `alive === false` (matches model hide).
- **LOD-aware only in the trivial sense:** the label renders at all
  LODs (including capsule fallback), because it's an identity marker,
  not a detail cue. It fades with distance-fog like other world text.
- Zero raycast surface — the label mesh is `raycast = () => {}` so it
  never intercepts shots.
- No pickup by shot-classifier — labels are decorative only; the
  existing collider path is untouched.

### 3. Shot-event console diagnostics

- On every player shot resolved against a bot, log a **single
  structured console line** in the form:
  ```
  [SHOT] botId=3 name=Sleepy hp=5→3 zone=body alive=true isDying=false lod=full dist=14.2
  ```
- Also log **kills** and **respawns** with the same shape:
  ```
  [KILL] botId=3 name=Sleepy causedBy=player headshot=false
  [RESPAWN] botId=3 name=Sleepy at=(x,z)
  ```
- Logging is gated behind a runtime flag `window.__toriiBotDiag`
  (default `true` while this ADR is Accepted; will flip to `false`
  or a build-time flag once the underlying bug is fixed and closed).
- Zero side-effects beyond `console.log`. No new events on the bus,
  no state changes.

### Non-goals (explicit)

This ADR does **not** touch:

- HP arithmetic, damage table (ADR-0007), or headshot classification
  (ADR-0011).
- Server-authoritative HIT resolution (ADR-0006).
- Collider positioning, death FSM, respawn timing, or the
  `_isDying`/`alive` transition.
- Bot AI, movement, or tactics.
- The pointer-lock / ESC / crosshair path (ADR-0010).

If Phase 1 (this ADR) uncovers changes needed in any of the above,
they land as **separate ADRs** with their own accept-then-code cycle.

## Consequences

- **Enables:** every future bot-related bug report becomes a name +
  bot-id + observable log line. "Sleepy took 12 shots and vanished"
  is now something we can search for in the console and correlate
  with a specific bot's trajectory.
- **Enables:** the SP↔MP unification proposal (ADR-0014, upcoming)
  gets a shared name-derivation module to point at.
- **Forecloses:** silently changing bot naming in either tree without
  updating the shared `botIdentity.js` module.
- **Trade-offs:** every bot now carries one extra sprite (small draw
  call, tiny memory). Console output grows during play — acceptable
  under a diag flag while we chase the stuck-bot bug.
- **Enforcement:** unit tests in `tests/bot-identity.test.js`:
  - `nameForBotId(0..6)` returns the seven dwarves in order.
  - `nameForBotId(7) === 'Doc'` (wraps).
  - The server sim populates `name` on every spawned regular bot.
  - The client-side fallback and server-side value agree for every
    id in `[0, 100)`.
- No regression-check rule added yet; a future rule can assert that
  every bot render path calls the shared identity helper.

## Alternatives considered

- **Random names per session**: rejected — the same bot id would
  change name each match and diagnostic value collapses.
- **Names in HUD panel only, not in-world**: rejected — you need to
  see the label while shooting, in your normal FOV, without pulling
  focus off the bot.
- **Deferring diagnostics until the bug is fixed**: rejected — the
  bug has already resisted one investigation cycle. Instrument first,
  fix second.
- **Making labels toggleable now**: rejected as premature. Ship
  always-on; add a toggle in a follow-up ADR once the bug is fixed
  and we decide whether always-on is the shipping default.

## Notes

- Follow-up ADR-0014 (proposed) will address unifying SP and MP tick
  paths so kill / death-anim / respawn semantics are identical in
  both modes.
- After the bug is fixed we may narrow the diagnostic log to
  kill/respawn only, or promote it to a proper telemetry hook.
