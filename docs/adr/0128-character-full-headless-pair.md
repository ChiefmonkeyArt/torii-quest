# ADR-0128: One character identity, paired full and first-person models

Status: accepted, implementing the operator's explicit 25 September 2026 correction.

## Context

The operator saw Poo Poo Head in the mirror instead of chiefmonkey.
His signed kind-35100 event references full mesh SHA-256
`7aecefff9ded689a1fce5afeb8b85fd954885ad422708e2d62f51c41a14d8cc3`
(`chiefmonkey7.glb`), which is already shipped in public/models.
The body had not been removed from the repo.

Login resolution was asynchronous and entry did not await it. Worse, completion
updated only the arena's custom headless URL, then reloaded both renderers while
the full-model seat still held the guest fallback. A failed custom full-model
download also silently rendered the guest, and a missing custom derivative could
borrow the guest headless model. The old chiefmonkey-headless asset was not
derived from the current chiefmonkey7 full model.

## Decision

The first-person loader reuses cloned idle/walk/run clips from the successfully
loaded full model. This includes its world-delta rig retargeting. Directly playing
chiefmonkey7's raw embedded clips on the derivative twisted its Y-up body;
head removal alone is not sufficient to preserve posture.

- The full GLB is the character identity: mirrors, self-view and peers use it.
- The headless GLB is derived from that exact full GLB, for local FP rendering
  only. It retains the character's own body/feet; it is not a replacement avatar.
- Resolve and seat full URL, mesh hash and headless URL together. Await login
  resolution before entry; ignore stale identity responses and serialise reloads.
- Content hashes of shipped chiefmonkey7 and animation-library GLBs resolve to
  local full/headless pairs. No display-name or universal-login-to-chiefmonkey
  override; other characters retain their own content identity.
- The authoring output records its source SHA-256 in GLB extras. Regenerate the
  chiefmonkey7 derivative and the template derivative from their respective full
  sources. Keep full files byte-identical.
- New uploads and AI results use one shared pair-author/upload function. Do not
  publish a new character manifest unless both blobs uploaded and the derivative
  hash agrees. Legacy missing derivatives may be authored on demand; failure hides
  only their FP body rather than substituting another character.
- Full-model load failure is visible/retryable, not silent guest substitution.

ADR-0127's FP-only arm silhouette filter remains a render detail on the private
FP instance. It does not modify either full source GLB or the mirror/peer rig,
and does not define character identity. This ADR clarifies that ownership.

## Verification

Tests execute the shell's actual pair seating functions to cover late login,
stale identity responses, guest choice and entry ordering. Resolver/upload tests
cover exact local full hashes, derivative source hashes, custom/legacy pairs,
failed derivation and mismatched uploads. Browser QA must render chiefmonkey7
through the full loader and its derivative through the FP loader, checking
their separate camera layers and the player's own feet.
