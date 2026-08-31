# ADR-0090: UGC sticker system — any-surface decals, Nostr-published library, multiplayer sync

- **Status:** Accepted
- **Date:** 2026-08-31
- **Deciders:** chiefmonkey
- **Related:** ADR-0088 (in-world raycast sticker placement — self-view slice parked),
  [`sticker-skin-system`](concepts/sticker-skin-system), ADR-0082 (Blossom upload /
  character publish), ADR-0006 (MP hit authority), Digital Assets & GLB/Npub Ownership
  (strategy.md), `src/stickerNpc.js`

## Context

The game already fires stickers from the gun: `src/stickerNpc.js` spawns a projectile,
flies it to the nearest hit, and parents it to whatever it struck — NPC/bot skinned-mesh
bones, crates, trees, terrain. But it has three hard limits:

1. **One hardcoded texture** — it always loads `/ftff-sticker.png`. There is no way to
   author, pick, or share a different sticker.
2. **Local and transient** — fired stickers exist only in the firing client's session.
   They are not replicated to other players and do not survive a reload.
3. **No user content** — there is no path for another player to create their own sticker
   and fire it from their own gun.

ADR-0088 shipped an *avatar self-decoration* slice at v0.2.726-alpha (an orbit camera to
place a sticker on your own character, persisted to the kind-35100 event). On playtest the
operator confirmed that slice is misaligned: the goal is not "decorate my own avatar", it is
**"sticker anything"** — place stickers on any world surface — and **"people create their
own stickers and fire them from their own guns"**. The self-view slice is parked (code kept,
feature inactive), but its pure placement model is reused here.

## Decision

1. **UGC sticker library.** Stickers become content-addressed images: upload via the existing
   Blossom path (`uploadBlossom`, ADR-0082) → sha256 hash → a Nostr metadata event (an
   extension of the `torii.asset` manifest from the Digital Assets section, with a sticker
   type). The shared library is resolved from that metadata; the single hardcoded
   `ftff-sticker.png` becomes just the seed entry, content-addressed so the default fire
   behaviour is unchanged.

2. **Any-surface placement.** Sticker raycast + attach targets **all** world geometry —
   full static meshes (world/walls/floors, trees, crates, terrain) *and* characters/NPCs
   (skinned). Static surfaces use decal baking; skinned surfaces keep the bone-parented
   `Object3D.attach` path already proven in `stickerNpc.js`. No curated subset remains.

3. **Multiplayer sync (cosmetic broadcast).** Stickers are cosmetic, so placement is
   **client-broadcast + server-relayed** over the existing arena WebSocket — *not*
   server-authoritative the way damage is (ADR-0006 keeps authority only for hits). A
   `sticker` message (image hash, surface point, normal, target id / bone when applicable)
   replicates a fired + attached sticker to peers. Rate-limited and gated to the NAP zone.

4. **Reuse the parked pure model.** `stickerRaycast.js` (hit → u/v/rot/zones) and
   `stickerPlacementMode.js` (enter→aim→confirm) from ADR-0088 stay; only the self-view
   orbit-camera UI is parked.

## Consequences

- **Enables:** user-generated sticker authoring and sharing; stickers on any surface;
  other players see stickers land in real time.
- **Forecloses:** nothing structural — the self-view avatar-decoration UI is parked, not
  deleted, and its model is reused.
- **Trade-offs:** cosmetic client-broadcast is trust-free, so abuse is real — mitigated by
  NAP-zone gating + a per-player rate limit; any-surface raycasting is a broader scene query
  per sticker than the old curated subset.
- **Enforcement:** keep the pure model unit-tested; validate inbound `sticker` messages
  (hex hash shape, size cap); a regression check asserts the seed ftff sticker resolves when
  no UGC library is loaded.

## Alternatives considered

- **Server-authoritative sticker placement** — heavier, and unnecessary for cosmetics; the
  ADR-0006 authority boundary (hits, not decorations) argues against it.
- **Keep avatar self-decoration primary (ADR-0088 as-is)** — rejected by operator feedback.
- **A brand-new asset kind vs. extending `torii.asset`** — extend `torii.asset`; exact
  sticker-type field is fixed at implementation.

## Notes

- Do not remove `stickerSelfView.js` / `stickerStudio.js` — park them (keep imports wired but
  feature-gated) so the model and future mirror-triggered placement stay intact.
- Version at decision: v0.2.726-alpha. See ADR-0088 for the raycast mechanics this builds on.