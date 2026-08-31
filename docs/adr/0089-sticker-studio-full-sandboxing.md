# ADR-0089 — Sticker studio full sandboxing (SkinnedMesh raycast inside the napplet iframe)

**Status:** Proposed · **Date:** 2026-08-31
**Deciders:** chiefmonkey
**Related:** ADR-0057 (NappletSurface), ADR-0083 (avatar shell), ADR-0085 (sticker studio wiring-only), ADR-0086 (release-time napplet identity, deferred), ADR-0088 (arena full sandboxing, deferred)

## Context

ADR-0085 registered the sticker studio as a `sticker-studio` avatar napplet through the ADR-0083 `avatar.*` contract, and the requires gate (`torii-avatar-write`) is enforced in the handlers. But the studio itself still lives in the main window: `fireStickerAtNpc` raycasts the target's `SkinnedMesh` directly, `Object3D.attach` moves the sticker into the target's bone hierarchy, and any character-key change goes through `playerModel.js`'s `setCharacter` — all with full main-window access, all sharing the same Three scene graph the shell renders.

Two things need proving before the studio is a real sandboxed napplet: (1) a `SkinnedMesh` raycast can be driven from *outside* the target's scene graph — the studio needs to know where its sticker landed on the target's skin, but the target's skin lives in the shell's Three world — and (2) the resulting attachment (parent bone, local transform, texture) can be described by a small snapshot the shell can apply to *its* copy of the target, without the studio ever holding a handle to the shell's `Object3D` graph.

The design pressure here is different from ADR-0088. The arena is a *world of its own* running next to the shell's world; the sticker studio is a *tool acting on the shell's world*. The arena renders inside its sandbox and sends snapshots out; the studio has to raycast the shell's world and send an attachment description back. Full sandboxing therefore hangs on a raycast bridge, not a WebGL bridge.

## Decision

**This ADR is design-only. No code changes yet.**

1. **Sandbox model.** Studio UI + preview render inside a `sandbox="allow-scripts"` iframe (same trust boundary as ADR-0083: opaque origin, no `allow-same-origin`, `MessageEvent.source` validated, per-mount channelId nonce, CSP `default-src 'none'; connect-src 'none'; img-src 'none'`). The iframe hosts a *local* Three scene — the sticker palette, the aim reticle, the preview of the sticker before commit. The shell hosts the *authoritative* Three scene — the target avatar's `SkinnedMesh`, the bone hierarchy, the rest pose. The studio never sees the shell's scene graph; it only sees snapshots of it.

2. **Avatar view snapshot.** Extend the `avatar.*` contract with `avatar.view.snapshot` — a request/response that returns a compact, versioned description of the target avatar the studio needs to aim at:
   - `{ t, characterKey, targetSurfaceId, bones: [{ name, worldMatrix4x3 }], skin: { boundingSphere: [x,y,z,r], skinnedMeshName, skeletonBindMatrices: [...] }, capabilities: [ 'nap-torii-character/v1' ] }`.
   Matrix4x3 (12 floats) is enough for the shell-side raycast; the studio never needs `SkinnedMesh` GPU buffers.

   **Animation staleness handling (decided, not open).** When the studio enters *aim-active* state (user is currently aiming), the shell **pushes** a fresh `avatar.view.snapshot` every `rAF` on a heartbeat until aim-active ends. When the studio is *idle* (palette browsing, tweaking non-spatial parameters), snapshots are **pulled** on demand. The studio signals aim-active via `avatar.aim.begin` / `avatar.aim.end` envelopes; the shell's snapshot pump keys off that flag. This keeps the bridge cost proportional to user intent (rAF-cadence snapshots only while aiming) while eliminating preview-slide-off during animation. Cost estimate: one snapshot is ~2-4 KB for a humanoid rig (~30 bones × 48 B matrix + skin ~1 KB), so ~120-240 KB/s during aim-active — comparable to ADR-0088's bridge budget and only paid during aiming.

   **Target selector included from day one.** `avatar.raycast.probe` and `avatar.view.snapshot` both accept an optional `targetSurfaceId` argument (defaulting to `'local-player'` in v0). Multi-target (NPCs, peer avatars) is deferred but the envelope shape does not need to change when it lands — the handler grows a target registry, not a new field.

3. **Raycast-in-shell protocol.** The studio does not raycast the target. Instead it sends `avatar.raycast.probe { origin: [x,y,z], direction: [x,y,z], targetSurfaceId?, surfaceId }` and the shell runs the raycast against *its* `SkinnedMesh` (the mesh already lives there, the skeleton is already skinned this frame, the bind matrices are already current). The shell returns `{ hit: true, boneName, localPoint: [x,y,z], localNormal: [x,y,z], uv?: [u,v] }` or `{ hit: false }`. The studio uses the local-space result to render its preview and to build the propose patch — but the actual raycast math never runs inside the sandbox.

   **Latency budget: ≤30 ms round-trip on the p95 machine** (revised from the initial <10 ms target, which was aspirational). `SkinnedMesh.raycast` on a ~15-30k-triangle humanoid takes 2-5 ms on a fast desktop and 10-20 ms on a low-end laptop; add postMessage round-trip (~1-3 ms) and the practical p95 lands in the 15-30 ms range. Migration step 1's benchmark harness measures the actual number against a stock Meshy humanoid; step 2 does not proceed if p95 exceeds 30 ms. If the measurement is worse, the fallback is to raycast against a decimated proxy mesh (bounding boxes per bone, or a 3-4k-tri LOD) that lives alongside the authoritative `SkinnedMesh`.

   **Raycast reentrancy: serve from the current frame's completed skeleton.** The shell caches the current `rAF` frame's skinned pose after Three's render step; `avatar.raycast.probe` requests within the same frame serve from that cache. Requests arriving during Three's render defer to the next `rAF`. This gives the raycast handler one deterministic pose to work against per frame.

4. **Attachment snapshot.** The studio's propose patch is not a Three `Object3D`. It is a small, versioned description:
   - `{ kind: 'attach', napplet: 'sticker-studio', targetSurfaceId, characterKey, targetBone: string, localPos: [x,y,z], localRot: [x,y,z,w], localScale: [x,y,z], textureRef: { kind: 'blossom-blob', sha256: string, mime: string } | { kind: 'blob-staged', blobId: string } | { kind: 'inline-base64', b64: string, mime: string }, size: [w,h] }`.

   **`inline-base64` size cap: 64 KB** (post-decode). The handler rejects `avatar.propose` with `{ error: 'inline-base64-too-large', maxBytes: 65536 }` above that. 64 KB is the practical ceiling before postMessage structured clone starts costing measurable frame time.

   **Blob upload path: shell-brokered, with a staging envelope.** The studio cannot upload to blossom directly — `connect-src 'none'` in the sandbox CSP forbids it. Because the `inline-base64` cap (64 KB) excludes larger stickers, the studio stages bytes outside the propose envelope:
   - `avatar.blob.stage { bytes: Uint8Array, mime }` → `{ blobId, sha256 }` — the shell buffers the bytes, uploads to the owner's blossom server, verifies the returned `sha256`, and returns a short-lived `blobId`. **Hard cap: 1 MB per staged blob** (matching Nostr `max_message_length` conventions); larger is rejected with `{ error: 'blob-too-large', maxBytes: 1048576 }`.
   - The studio then commits with `{ textureRef: { kind: 'blob-staged', blobId } }`; the shell resolves `blobId` to `{ kind: 'blossom-blob', sha256, mime }` at sign time.
   For small stickers (≤64 KB) the studio may still commit with `inline-base64` and the shell performs the same upload-and-rewrite before signing. If blossom upload fails, the shell falls back to signing with `inline-base64` (the event carries the bytes) or rejects the propose — configurable per owner policy in a later ADR. **The studio never sees blossom credentials, never sees blossom URLs.**

   **Stale-rig rejection.** If the target's rig has changed between snapshot-and-propose (character swap, model reload), the shell rejects with `{ error: 'stale-target-rig', currentCharacterKey, requestedCharacterKey, requestedTargetBone }` and the studio must refresh via `avatar.view.snapshot` and retry. The shell compares **both** the patch's `characterKey` (captured in the snapshot) and its `targetBone` against the current rig: a `characterKey` mismatch is stale **even if a bone with the same name exists** (two Mixamo rigs share names like `mixamorig:LeftHand` but the local transform means something different on each rig), and a missing `targetBone` is stale.

   **Preview transport: shell-side rendering, patch-shaped.** The studio's aim preview (sticker at the aimed hit point, before commit) is rendered by the **shell**, not the studio's iframe overlay. The studio sends `avatar.preview.set { patch: <same attachment shape>, previewId }` — the shell renders the sticker on its own avatar with a `previewId` marker (dimmer, marked "preview") and clears it on `avatar.preview.clear { previewId }` or on commit. **Preview resolution is last-write-wins per `previewId`:** re-aiming with the same `previewId` replaces the existing preview in place, and `previewId` is a studio-chosen opaque string so a single studio can hold at most one live preview per id (rapid re-aim does not leak a stack). This means the preview code path is the same as commit, only marked non-authoritative; the studio's iframe stays a UI panel and never composites over the shell.

   `avatar.propose` on the attachment shape passes through the requires gate (unchanged from ADR-0085), the shell asks the owner, signs the character event (kind 35100 addressable, `d="torii-character"`), stamps the contrib tag with `(dTag, aggregateHash) = ('sticker-studio', <release hash>)`, and publishes. The shell rebuilds *its* scene graph from the signed event; the studio never mutates the shell's `Object3D` graph directly.

5. **Bundle model.** The studio napplet ships as a static bundle addressed by the `NAPPLET_IDENTITY` hash ADR-0086 will assign. The bundle carries its own Three vendor chunk for the preview (Rapier is not needed — the studio does not simulate physics). Cost budget: ~700 KB three-vendor, cached by hash on the shell's fetch, second load free.

6. **Migration path.** Three PRs, each independently mergeable:
   1. **View-snapshot shim.** Extend `avatar.get` handlers (from ADR-0083) with an optional `include: ['view']` argument that returns the `avatar.view.snapshot` shape. Old callers ignore it. Lock the shape in tests.
   2. **Raycast handler + iframe host.** Add `avatar.raycast.probe` to `createAvatarHandlers` — the shell-side raycast, wired to `stickerNpc.js`'s existing raycast helper. New `NappletStickerStudioSandbox` (a specialisation of `NappletSurface` for the studio) mounts the studio bundle in an iframe, wires the request/response envelopes, keeps `avatar.propose` gated by `torii-avatar-write` (unchanged). Feature-flagged; the in-window studio still ships until the flag flips.
   3. **Flag flip + old path deletion.** Once the sandboxed studio passes a full aim-and-commit smoke test on `chiefmonkey.art/quest/` and `torii.plebeian.build`, delete the in-window `fireStickerAtNpc` bootstrap.

7. **Non-goals for this ADR.**
   - Not a rewrite of `stickerNpc.js`'s raycast math. The math moves to a shell-side handler and stays identical.
   - Not a change to `playerModel.js` or `setCharacter`. `avatar.propose` still routes through the shell's existing character-write path.
   - Not a change to the requires gate or the `torii-avatar-write` capability. Gate stays in the handlers, per ADR-0083.
   - Not a change to the character event kind, `d` tag, or contrib-tag shape. Frozen.

8. **ADR-0086 dependency (cross-cutting).** Migration step 3 (flag flip + old-path delete) **must not land before ADR-0086** — otherwise the studio ships in production with `NAPPLET_IDENTITY = 'sticker-studio@v0-wiring'` and the character event's `contrib` tag records a placeholder rather than a real bundle hash. Steps 1 and 2 are safe under the placeholder because the sandboxed studio runs alongside the in-window studio behind the feature flag; only step 3 makes the placeholder authoritative. The bundle-loading protocol is pending ADR-0086, same as ADR-0088.

## Consequences

- **Enables:** third-party sticker napplets, face-forge napplets, and animation-loader napplets to write the character through exactly the same contract, with the shell owning every raycast against the authoritative skeleton. Honest `contrib` provenance because the studio is genuinely a sandboxed contributor.
- **Forecloses:** any studio code touching the shell's `Object3D` graph, any studio-side `SkinnedMesh` raycast against the shell's target, any direct texture upload that bypasses `avatar.propose`.
- **Trade-offs:** duplicated Three bundle in the studio (cached, bounded), a request/response round-trip for every aim update (mitigated by only requesting on user-driven aim events, not per-frame), and a new snapshot shape that the shell has to keep stable as its rig changes. The alternative is worse: giving a sticker napplet `SkinnedMesh` access is the exact leak that makes a sandbox pointless.
- **Enforcement:** unit tests lock the `avatar.view.snapshot`, `avatar.raycast.probe`, `avatar.blob.stage`, and attachment-patch shapes; the requires-gate tests from ADR-0083/0085 carry over unchanged. Integration tests mount the studio bundle in a real iframe under jsdom + a fake `postMessage` transport and drive a headless aim-and-commit. **jsdom does not enforce `sandbox` origin isolation** — the jsdom suite validates envelope shapes and the requires gate; a real-browser smoke (Playwright against the deployed URL) validates the sandbox itself.

## Alternatives considered

- **Give the studio a `SkinnedMesh` handle across the boundary.** Rejected — a `SkinnedMesh` is a live handle to GPU buffers on the shell's origin. Handing it across is either impossible (structured clone drops it) or an XSS (`allow-same-origin`).
- **Snapshot the whole scene graph.** Rejected — the studio doesn't need the scene graph, it needs a raycast result. Snapshotting bones + bind matrices is one order of magnitude smaller.
- **Push view snapshots every frame.** Rejected — the studio doesn't aim every frame. Pull-on-aim keeps the bridge cost proportional to user intent.
- **Run the raycast inside the sandbox.** Rejected — the studio doesn't have the target's `SkinnedMesh`. It would need one, and shipping it is exactly the leak this ADR exists to prevent.
- **Do full sandboxing before wiring (skip ADR-0085).** Rejected — see ADR-0085. Wiring first lets both directions converge on the same contract.

## Notes

Design doc only. No files added, no tests added. First implementation PR is the view-snapshot shim (migration step 1) and lands under its own PR after this ADR is accepted.

**Decisions locked in this revision (previously open):**

- Animation staleness: **rAF-cadence push during aim-active, pull-on-demand when idle**. `avatar.aim.begin` / `avatar.aim.end` gate the pump.
- Raycast reentrancy: **serve from current-frame cached pose**, defer during Three's render to next `rAF`.
- Raycast latency: **budget ≤30 ms p95**, measured by migration step 1 benchmark. Fallback is bone-BBox or 3-4k-tri LOD proxy mesh if the authoritative `SkinnedMesh` misses.
- `inline-base64` cap: **64 KB post-decode**, handler-enforced with `inline-base64-too-large` error.
- Blob upload: **shell-brokered via new `avatar.blob.stage` envelope** (1 MB hard cap). Studio commits with `blob-staged` ref or `inline-base64`; shell uploads to blossom, rewrites `textureRef`, then signs.
- Preview transport: **shell-side rendering, patch-shaped**, last-write-wins per `previewId`. Studio sends `avatar.preview.set/clear`; iframe never composites over the shell.
- Target selector: **`targetSurfaceId` in the envelope from day one**, defaulting to `'local-player'`.
- Stale-rig: **shell rejects `avatar.propose` with `stale-target-rig` unless `characterKey` and `targetBone` both match the current rig**; studio refreshes and retries.

**Still open (deferred to migration-step review, not blocking this ADR):**

- Revert protocol: does undo flow through a separate `avatar.revert { proposalId }` (recommended — revert is not a raycast) or is it a special-cased attachment patch? Design lands with step 2.
- Blossom-upload failure policy: fall back to `inline-base64` in the signed event, or reject the propose? Owner-configurable, spec lands with the shell's blossom-broker code in step 2.
- Multi-target v0 scope: NPCs and peer avatars are excluded from v0. Whether v1 adds a target-selector UI or defers to a later face-forge napplet is a product decision, not a design one.
