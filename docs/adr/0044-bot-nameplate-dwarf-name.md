# ADR-0044: Bot nameplate shows the dwarf name, not "regular"

- **Status:** Accepted
- **Date:** 2026-08-24
- **Version:** v0.2.664-alpha
- **Relates to:** ADR-0013 (dwarf-name nameplates)

## Context

The owner reported bots named "regular" in the live arena. The server snapshot
(`server/bots/arenaBotSim.js` `snapshot()`) only stamps `name` for the **boss**
(`s.name = st.name || BOSS_NAME`); regular-bot frames are intentionally
nameless on the wire to keep the per-frame byte count minimal ("regular-bot
frames stay byte-identical on the wire"). The design (ADR-0013) expects the
client to derive the dwarf name from the bot id via `nameForBotId(id)`.

The nameplate **label** did this correctly at attach time
(`label = st.name || nameForBotId(st.id)`). But the HP-chip redraw in
`applyBotHit` / `applyBotKill` — `bot.model?.updateNameplate(bot.state?.name
|| bot.state?.kind || '', hp)` — fell back to `bot.state.kind` ('regular')
when `bot.state.name` was missing. Since the server never sends a name for
regulars, every HP chip read "regular" instead of Doc / Grumpy / Happy / etc.

## Decision

Change the `updateNameplate` fallback in both `applyBotHit` and `applyBotKill`
from `bot.state?.kind` to `nameForBotId(botId)`:

```
bot.model?.updateNameplate(bot.state?.name || nameForBotId(botId), hp / maxHp);
```

- **Regulars** (no `name` on the wire): now show the dwarf name derived from
  the bot id (Doc, Grumpy, Happy, Sleepy, Bashful, Sneezy, Dopey — wraps on
  `id % 7`).
- **Boss** (id=4): `bot.state.name === 'Augustink'` is truthy, so the fallback
  is never reached — the boss name is unchanged.

No server / wire-protocol change. No change to the boss path.

## Consequences

- The HP chip + nameplate now consistently read the dwarf name for regulars.
- `applyBotHit` / `applyBotKill` are not directly unit-testable (they depend on
  module-level singletons in `bots.js` — `_botNet`, `_botById`, the scene).
  Regression coverage for the name + death + combat values will come from the
  target-practice end-to-end test suite (see follow-up), not a unit test of
  these functions.
