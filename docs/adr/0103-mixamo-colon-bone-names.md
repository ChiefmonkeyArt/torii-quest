# ADR-0103: Character Forge — accept the `mixamorig:` colon form of Mixamo bone names

- **Status:** Accepted
- **Date:** 2026-09-02
- **Version:** v0.2.745-alpha
- **Related:** ADR-0091 (Character Forge — validator-first)

## Context

The Character Forge auto-rig validator (`src/engine/character/skeleton.js`) is the
first gate a third-party GLB has to pass before it can become a playable Torii
avatar. The validator identifies a bone convention by looking for a known prefix
(`mixamorig` or `Bip01`), then maps each bone name onto a canonical role
(`Hips`, `Spine`, `LeftUpperArm`, …) via `MIXAMO_BONE_MAP` / `BIPED_BONE_MAP`.

The Mixamo bone-map keys were written as `mixamorigHips`, `mixamorigSpine`, and
so on — the form Adobe's FBX-to-Blender pipeline emits when it strips the
namespace colon. **Every other real-world Mixamo GLB uses the colon form**:
`mixamorig:Hips`, `mixamorig:Spine`, … That is what Blender's glTF exporter
writes, what Ready Player Me avatars carry, and what the entire
Mixamo-through-glTF pipeline preserves.

The consequence: any operator uploading a genuine Mixamo GLB through the
Character tab's "Upload .glb" flow saw the validator refuse it with **"Missing
required roles: Hips, Spine, Neck, Head, …"** — every required role listed as
missing, because the exact-key lookup `map[n]` returned `undefined` for every
`mixamorig:Hips`-style bone.

Verified against `8thwall/web/examples/aframe/animation-mixer/mixamo-animated-lowpoly.glb`
(a real, public, Mixamo-rigged 1.1 MB GLB): 68 nodes, 65 Mixamo bones,
100% colon-form, verdict `unknown-convention` (pre-fix) despite being a
perfect Mixamo skeleton. Effectively the "Upload a character" path was blocked
for every operator except one specific Adobe-FBX-through-a-particular-version-
of-Blender flow.

## Decision

Add a pure `normalizeBoneName(name)` function to `skeleton.js` that maps every
common Mixamo bone-name shape to the canonical no-colon form the map is keyed on:

- `mixamorig:Hips` → `mixamorigHips` (Blender/glTF form — the common case)
- `Armature:mixamorig:Hips` → `mixamorigHips` (nested-armature form)
- `mixamorigHips` → `mixamorigHips` (Adobe FBX form — unchanged, fast path)
- `Bip01 Spine` → `Bip01 Spine` (Biped form — preserves internal spaces, unchanged)
- `namespace:root` → `root` (defensive: strip any leading namespace prefix)

`detectConvention` normalizes before its `startsWith` sniff so a colon-form
skeleton is classified as `mixamo` rather than `unknown`.

`mapBonesToRoles` normalizes before the map lookup, so every colon-form bone
maps to its role. **The original bone name (with colon) is preserved in the
returned `mapped` dictionary** — the caller still needs the exact node name to
address the scene node in the GLTF, and the auto-rigger's downstream code
(peer avatar loader, sticker-zone raycast) reads `mapped[role]` to get that.

## Alternatives considered

1. **Rewrite `MIXAMO_BONE_MAP` to key on `mixamorig:X`** — rejected. Would flip
   the failure mode from "Blender exports fail" to "Adobe-FBX exports fail", and
   there is no reason to pick one convention over the other.

2. **Duplicate every entry** (`mixamorigHips` AND `mixamorig:Hips`) — rejected.
   Doubles the map size, doesn't cover the `Armature:mixamorig:Hips` nested
   form, and adds a new failure mode where the two entries drift.

3. **Fix at the parser (glTF-loader boundary)** — rejected. The bone-name
   normalization is a property of the *convention*, not the *file format*. A
   future FBX-direct import path would hit the same issue and would have to
   re-implement the same normalization. Keeping it in `skeleton.js` means every
   caller — validator, sticker-zone resolution, peer-avatar path — inherits it
   automatically.

## Consequences

**Immediate.** The Character tab's "Upload .glb" path now accepts real Mixamo
GLBs (Blender export, Ready Player Me, Text2Motion, etc.). Upstream validator
`assessRig` returns verdict `riggable` for the sample GLB checked in this ADR
(22/22 roles mapped, `requiredMissing: []`).

**Sticker placement.** `resolveZoneFromBoneNames` in `stickerPlacement.js` calls
`mapBonesToRoles`, so in-world sticker placement onto a Mixamo-uploaded
character now correctly resolves body zones. No code change in that path.

**Peer-avatar path.** The MP `character` field carries a mesh sha256 hash; the
peer loader resolves it to a Blossom URL and renders the mesh. The peer path
uses `mapBonesToRoles` to resolve animation-clip retargeting. That path now
works for real Mixamo peers, same as self.

**Bundle size.** `normalizeBoneName` adds ~15 lines to `skeleton.js` (a pure
node-safe module). No new imports, no new dependencies.

**Backwards compatibility.** Adobe-FBX-form GLBs (with no-colon bones) still
work — the fast path in `normalizeBoneName` short-circuits when there is no
colon in the name.

## Follow-up

- Later slice: extend the same normalization to accept common non-`mixamorig`
  humanoid conventions (VRM, Godot's OpenBot bone map) via new entries in
  `BONE_MAPS`. Out of scope for this fix.
- Consider surfacing the auto-rig verdict in the Character tab UI so operators
  see *why* an uploaded mesh was accepted or rejected — not just success/fail.
