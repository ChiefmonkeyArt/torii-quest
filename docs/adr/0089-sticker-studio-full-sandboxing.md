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
   - `{ t, characterKey, bones: [{ name, worldMatrix4x3 }], skin: { boundingSphere: [x,y,z,r], skinnedMeshName, skeletonBindMatrices: [...] }, capabilities: [ 'nap-torii-character/v1' ] }`.
   Matrix4x3 (12 floats) is enough for the shell-side raycast; the studio never needs `SkinnedMesh` GPU buffers. Snapshots are refreshed on request (studio pulls when the user aims) rather than pushed every frame — a `SkinnedMesh` raycast for aim is a rare event, not a per-frame event.

3. **Raycast-in-shell protocol.** The studio does not raycast the target. Instead it sends `avatar.raycast.probe { origin: [x,y,z], direction: [x,y,z], surfaceId }` and the shell runs the raycast against *its* `SkinnedMesh` (the mesh already lives there, the skeleton is already skinned this frame, the bind matrices are already current). The shell returns `{ hit: true, boneName, localPoint: [x,y,z], localNormal: [x,y,z], uv?: [u,v] }` or `{ hit: false }`. The studio uses the local-space result to render its preview and to build the propose patch — but the actual raycast math never runs inside the sandbox.

   This is the design point that ADR-0089 exists to prove: the shell can run a `SkinnedMesh` raycast against a live skeleton and return a bone-local hit fast enough for interactive aiming (target: <10 ms round-trip on the main thread at 60 Hz shell rAF).

4. **Attachment snapshot.** The studio's propose patch is not a Three `Object3D`. It is a small, versioned description:
   - `{ kind: 'attach', napplet: 'sticker-studio', targetBone: string, localPos: [x,y,z], localRot: [x,y,z,w], localScale: [x,y,z], textureRef: { kind: 'blossom-blob', sha256: string, mime: string } | { kind: 'inline-base64', b64: string, mime: string }, size: [w,h] }`.
   `avatar.propose` on this shape passes through the requires gate (unchanged from ADR-0085), the shell asks the owner, signs the character event (kind 35100 addressable, `d="torii-character"`), stamps the contrib tag with `(dTag, aggregateHash) = ('sticker-studio', <release hash>)`, and publishes. The shell rebuilds *its* scene graph from the signed event; the studio never mutates the shell's `Object3D` graph directly.

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

## Consequences

- **Enables:** third-party sticker napplets, face-forge napplets, and animation-loader napplets to write the character through exactly the same contract, with the shell owning every raycast against the authoritative skeleton. Honest `contrib` provenance because the studio is genuinely a sandboxed contributor.
- **Forecloses:** any studio code touching the shell's `Object3D` graph, any studio-side `SkinnedMesh` raycast against the shell's target, any direct texture upload that bypasses `avatar.propose`.
- **Trade-offs:** duplicated Three bundle in the studio (cached, bounded), a request/response round-trip for every aim update (mitigated by only requesting on user-driven aim events, not per-frame), and a new snapshot shape that the shell has to keep stable as its rig changes. The alternative is worse: giving a sticker napplet `SkinnedMesh` access is the exact leak that makes a sandbox pointless.
- **Enforcement:** unit tests lock the `avatar.view.snapshot`, `avatar.raycast.probe`, and attachment-patch shapes; the requires-gate tests from ADR-0083/0085 carry over unchanged. Integration tests mount the studio bundle in a real iframe under jsdom + a fake `postMessage` transport and drive a headless aim-and-commit.

## Alternatives considered

- **Give the studio a `SkinnedMesh` handle across the boundary.** Rejected — a `SkinnedMesh` is a live handle to GPU buffers on the shell's origin. Handing it across is either impossible (structured clone drops it) or an XSS (`allow-same-origin`).
- **Snapshot the whole scene graph.** Rejected — the studio doesn't need the scene graph, it needs a raycast result. Snapshotting bones + bind matrices is one order of magnitude smaller.
- **Push view snapshots every frame.** Rejected — the studio doesn't aim every frame. Pull-on-aim keeps the bridge cost proportional to user intent.
- **Run the raycast inside the sandbox.** Rejected — the studio doesn't have the target's `SkinnedMesh`. It would need one, and shipping it is exactly the leak this ADR exists to prevent.
- **Do full sandboxing before wiring (skip ADR-0085).** Rejected — see ADR-0085. Wiring first lets both directions converge on the same contract.

## Notes

Design doc only. No files added, no tests added. First implementation PR is the view-snapshot shim (migration step 1) and lands under its own PR after this ADR is accepted.

Open questions for review:

- Snapshot cache: does the shell memoise `avatar.view.snapshot` for a frame, or recompute per request? Memoising per-frame is safe (skeleton has only one bind pose per frame) and cheap.
- Raycast reentrancy: what happens if the studio requests a raycast while the shell is mid-render? The shell should either serve from the last completed frame or defer to the next `rAF` — locking to the current frame is simplest.
- Texture transport: `blossom-blob` (content-addressed, deduplicated) is the target, but the studio needs a fallback for a fresh sticker not yet uploaded. `inline-base64` covers that at up to ~100 KB; anything larger should require a blossom upload before propose.
- Multi-target: v0 targets exactly one avatar (the local player). Aiming at NPCs or peer avatars is a later ADR — the raycast handler needs a target selector, which is currently implicit.
