# ADR-0091: Character Forge — validator-first character pipeline with auto-rig groundwork

> **Renumbered 0082 → 0091 on 2026-09-01.** ADR-0082 collided with the napplet game-host scaffold (ADR-0082, PR #84), so this Character Forge ADR took the next free number. Cross-references in ADR-0086/0087/0090 updated accordingly.

- **Status:** Accepted
- **Date:** 2026-08-31
- **Deciders:** chiefmonkey
- **Related:** ADR-0078 (settings panel), ADR-0086 (sticker placement model), ADR-0087 (validator-gated mesh generation), `nap-torii-avatar-v0.md`, `torii-asset-behavior-v1.md`, the "Torii Asset Forge" entry in `torii-quest-strategy.md`

## Context

Players need a way to create their own playable character in Torii. Two paths
were on the table: (a) build an in-house AI that generates a mesh + skin + GLB
from scratch, or (b) orchestrate third-party generators (Meshy, Tripo,
Hunyuan3D, InstantMesh) and own only the piece that makes their output usable
in-world.

Building a 3D-generation model is a huge, well-funded race we cannot win. The
durable, high-value piece is the **interoperability contract**: turning "an AI
made a humanoid mesh" into "it walks in Torii" — canonical bone mapping, scale
and axis normalization, sticker-zone metadata, and a signed Nostr character
event other worlds can resolve. That gap is exactly where every project like
ours loses weeks, and it is not glamorous enough for the big labs to solve.

`nap-torii-avatar-v0` already defines a character as a **signed Nostr event**
(kind 35100, `d` tag `torii-character`) referencing a mesh GLB by Blossom
sha256, plus clips, stickers, name, colors, and a contribution lineage. The
Torii Asset Forge already commits to "validator-first, not generator-first" for
static assets. This ADR extends that same principle to characters.

## Decision

We build the **Character Forge as a validator-first pipeline**: we do not build
a character-generation AI. We build (1) the canonical skeleton contract and
auto-rig assessment that map arbitrary third-party bone conventions onto
Torii's animation library, (2) the `torii.character` manifest validator, and
(3) the kind-35100 character-event parser that lets a player who already has a
`.glb` attached to their npub be seated with zero friction. Generation is
orchestrated through external services via routstr/Cashu and gated by the
validator; the UI lives in its own "Character" settings tab.

## Consequences

- **Enables:** any third-party mesh generator becomes a Torii character source
  once its output passes the validator; players with an existing character
  event are seated automatically (the "smooth experience" seam); the
  interoperability contract becomes publishable and adoptable by other Nostr
  worlds.
- **Forecloses:** an in-house 3D generation / texture model (out of scope);
  auto-rigging an **unrigged** (bone-less) mesh (would need skeleton
  generation, deferred past v1).
- **Trade-offs:** we depend on external generators whose output is uneven and
  must fail closed through the validator; v1 ships presets + stickers with no
  AI generation at all, so the full loop is proven before any model is wired.
- **Enforcement:** pure, node-safe modules under `src/engine/character/`
  (`skeleton.js`, `rigAssessment.js`, `characterManifest.js`,
  `characterEvent.js`) each locked by a test file; the settings tab inventory
  is pinned by `tests/settings-panel.test.js`; SDK exposure is at the
  experimental tier.

## Alternatives considered

- **Build an in-house generation model** — rejected: enormous cost, races a
  $100M+ industry, and none of the value is in generation (it is all in the
  compatibility contract).
- **Adopt a single third-party generator directly** — rejected: couples us to
  one vendor; the validator-first seam keeps generators swappable.
- **Ship character creation without the Nostr event** — rejected: the portable,
  npub-owned character event is what makes characters work across worlds.

## Notes

- The canonical skeleton is role-based (Hips/Spine/Neck/Head/limbs), not
  name-based, so Mixamo (`mixamorig*`) and legacy Biped (`Bip01*`) conventions
  both map onto it. See `src/engine/character/skeleton.js`.
- The "check whether the npub already has a `.glb`" relay read is a follow-up
  slice; this ADR lands the pure parser (`characterEvent.js`) and the settings
  tab, not the live relay round-trip.
