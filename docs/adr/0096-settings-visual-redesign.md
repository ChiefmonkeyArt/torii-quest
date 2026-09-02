# ADR-0096: Settings Panel — Neutral Visual System + Character Select/Create Redesign

- **Status:** Accepted
- **Date:** 2026-09-01
- **Deciders:** chiefmonkey (+ Perplexity Computer agent)
- **Related:** ADR-0078 (settings panel), ADR-0091 (Character Forge validator-first), ADR-0094 (server-side presence beacon), ADR-0095 (settings click-propagation fix), `src/engine/settings/*Panel.js`, `src/engine/ui/instanceSettings.js`, `index.html` (`<style>`)

## Context

The settings panel was styled as a dark amber/sepia glass-morphism surface that
matched the game's title screen, but the operator (chiefmonkey) found it did not
read as a conventional "settings page": cramped spacing, long full-sentence
copy, and near-duplicate per-tab CSS (`.pf-*`, `.rl-*`, `.gs-*`, `.hb-*` with
separate but almost identical input/button/card rules). The Character tab in
particular was a wall of undifferentiated buttons rather than a character
select/create screen. The ask: shorten copy, modernise, add space, and make all
six tabs (Profile, Gateway Setup, Heartbeat, Relay, Access, Character)
visually consistent.

Two product facts bound the redesign:

- **Character creation is validator-first**, not generator-first (ADR-0091):
  v1 ships preset selections + sticker placement + upload-your-own `.glb`; an
  AI mesh-generator path (Meshy-style, orchestrated via routstr/Cashu) is a
  later slice. The "create with AI" affordance must therefore be a real,
  prominent slot that is *not yet wired*.
- **Presence is now server-side** (ADR-0094): the heartbeat beacon auto-ons
  from the configured admin npub at install, with no browser login or wallet.
  The Heartbeat tab's copy still described the outdated client-side flow and
  needed correcting alongside the restyle.

## Decision

1. Replace the amber/sepia glass-morphism with a **neutral dark settings
   surface**: charcoal backgrounds, one calm teal accent (`--settings-accent`)
   used only for active-nav / focus / primary-CTA / switch-on states, and
   red/green reserved strictly as semantic error/success. A new `--settings-*`
   token layer is scoped under `#torii-settings-panel` so the rest of the game
   UI's amber theme is untouched.
2. Consolidate the near-duplicate per-tab classes into a shared
   `.settings-*` component set (header/title/subtitle, badge, gate, note,
   empty, list, card, button primary/ghost/sm, form, row, label, input,
   textarea, switch) used by all tabs; retain only genuinely tab-specific
   modifiers (Relay default-row banner, Character preset/summary/sticker
   layout).
3. Shorten copy across Profile, Gateway Setup, Heartbeat, and Relay to
   concise settings-page phrasing, preserving meaning. (Access copy is left
   literal — it is locked by `tests/instance-settings.test.js`; CSS restyle
   only there.)
4. Rebuild the Character tab as a **select + create screen**: a preset card
   grid (name + Select), two clearly separated creation cards — **"Upload a
   character"** (live, `data-action="upload-mesh"`) and **"Create with AI"**
   (rendered `disabled`, a "Coming soon" badge, `data-action="create-with-ai"`
   with **no handler**, pending the ADR-0091 Meshy/routstr integration) — a
   summary card for the "found" state, and a cleaner sticker editor (placed
   list + labeled library grid).
5. Correct the Heartbeat tab copy to the ADR-0094 server-beacon reality
   ("on by default · no login or wallet needed"), updating
   `heartbeatPanel.test.js` which had locked the stale client-side wording.

## Consequences

- **Positive:** all six tabs share one typographic scale (title 20 / section
  14 / body 13 / caption ~11.5), one spacing scale, and one component style,
  so the panel reads as a single, coherent settings UI; the Character tab now
  presents the real v1 capability honestly (2 presets + upload, AI path
  clearly teed-up but not fake-wired).
- **Negative / risk:** none functional — every pre-existing `data-action`,
  `data-*`, form `name`/`id`, and `data-form` string is preserved (the
  delegated router in `main.js` is unchanged); the only addition is the
  disabled, unwired `create-with-ai` action.
- **Follow-on (tracked separately):** wire `create-with-ai` to the Meshy /
  routstr / Cashu generation flow (prompt/image → job → validate → save to
  npub) when that slice lands; consider trimming the Access tab's copy when
  its test lock is revisited.