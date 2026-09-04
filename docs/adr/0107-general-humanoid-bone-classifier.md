# ADR-0107: General humanoid bone classifier

- **Status:** Accepted
- **Date:** 2026-09-04
- **Version:** v0.2.759-alpha
- **Deciders:** chiefmonkey
- **Related:** ADR-0091 (Character Forge — validator-first), ADR-0087 (validator-gated external mesh generation), ADR-0103 (Mixamo colon bone names), `src/engine/character/skeleton.js`, `src/engine/character/rigAssessment.js`

## Context

ADR-0091 committed the Character Forge to a **validator-first** pipeline: we do not
build a 3D generator, we orchestrate external ones and gate their output. The
validator (`skeleton.js`) maps a third-party rig's bone names onto a canonical,
role-based Torii skeleton so the animation library can drive it.

Two of the four conventions we care about — Mixamo (`mixamorig*`) and 3ds Max
Biped (`Bip01*`) — had explicit tables, and ADR-0103 fixed the `mixamorig:`
colon form. But the two AI generators we actually plan to accept produce **yet
different** rigs, and neither resolved:

- **Tripo** (`Hip`, `L_Thigh`, `L_Calf`, `L_Upperarm`, `Waist`, `Spine01`, …)
- **Meshy** (`Hips`, `Spine`, `LeftArm`, `LeftForeArm`, `LeftUpLeg`, `LeftLeg`,
  even lowercase `neck` — the prefix-stripped Mixamo style, also used by the
  Unreal Mannequin)

The `detectConvention` prefix sniff (`startsWith('mixamorig')` /
`startsWith('Bip01')`) classified both as `unknown-convention`, so the validator
failed closed on exactly the rigs the "Create with AI" path is meant to emit.
The guest-avatar GLBs uploaded for the anonymous-entry feature are one of each
(the raw Tripo head, and the Meshy re-export `head4`), so this blocked real work
in hand.

The deeper problem: adding one exact string table **per vendor** is a treadmill.
New generators (and new rig-export pipelines) appear constantly, and each one
misses its table until someone files an issue. The durable piece we own is
**interpreting** any humanoid rig, not tracking vendors.

## Decision

Extend `skeleton.js` so bone→role resolution is **general rather than per-vendor**:

1. Add explicit tables for the two known AI conventions — `TRIPO_BONE_MAP` and
   `GENERIC_HUMANOID_BONE_MAP` (the latter covers Meshy's prefix-stripped Mixamo
   output and the Unreal Mannequin).
2. Add `classifyBone(name)`: a keyword + side heuristic that maps an **arbitrary**
   humanoid bone name onto a role without a table (word prefixes `LeftArm`,
   short prefixes `L_Thigh`, Unreal suffixes `thigh_l`). It is conservative and
   returns `null` unless confident, so helper/noise nodes never map.
3. Make `detectConvention` score over all tables (highest table wins) instead of
   prefix-sniffing, and make `mapBonesToRoles` resolve each bone exhaustively
   (all tables, then the heuristic) so a mixed or brand-new convention still
   maps.
4. Make `rigAssessment.js`'s verdict **mapping-based** (`riggable` when every
   required role maps, regardless of convention label) so the heuristic's
   results are honoured.

## Consequences

- **Enables:** any humanoid generator (Meshy, Tripo, and future ones) becomes a
  Torii character source once its rig resolves; the anonymous-entry guest
  avatars pass the validator; the "Create with AI" backend wiring needs no
  further bone-name work.
- **Forecloses:** none — the explicit tables remain, and Mixamo/Biped behaviour
  is unchanged (all prior tests still pass).
- **Trade-offs:** a heuristic can mis-map an unusual name; mitigated by running
  it only as a fallback *after* the exact tables, by the conservative noise
  gate, and by the fail-closed validator (`unknown-convention` when nothing
  maps). A human override/rename step remains possible upstream.
- **Enforcement:** `tests/character-skeleton.test.js` locks every convention
  (Mixamo, Biped, Tripo, generic) plus the heuristic's positive and
  negative cases, using the actual guest-avatar GLB bone names; `rigAssessment`
  verdicts are locked by `tests/rig-assessment.test.js`. The SDK re-exports both
  modules unchanged (`export * as characterSkeleton` / `rigAssessment`).

## Alternatives considered

- **One exact string table per generator, on demand** — rejected: a treadmill;
  every new vendor ships broken until a table lands.
- **Rewrite the existing Mixamo/Biped tables around the stripped form** —
  rejected: would flip which export form fails (the exact failure ADR-0103
  fixed), and break the "preserve the original node name" contract.
- **Auto-rig an unrigged (boneless) mesh** — rejected / deferred: out of scope
  for v1 per ADR-0091; this ADR only *maps* an existing rig, it does not
  *generate* a skeleton.

## Notes

- Actual observed conventions (from the two reported GLB skeletons) are encoded
  as test fixtures so the mapping is grounded in real files, not speculation.
- **Retargeting is deliberately out of scope here.** Mapping names onto roles is
  only half the job; when a mesh's rest pose, bone count, or joint orientation
  differ from the canonical skeleton, true weight retargeting is required. That
  remains a follow-up decision (offline `tools/glb_retarget.py` bake, as done
  for `nostrich`, vs. an in-browser `SkeletonUtils.retarget` pass) and should be
  captured in its own ADR when chosen.