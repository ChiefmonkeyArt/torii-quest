# ADR-0127: First-person weapon/body rendering ownership

Status: accepted for the reported empty-hand regression.

## Context

The first-person gun is an independent camera-space viewmodel in `gunScene`.
The headless first-person body has its own unarmed idle/walk/run clips
(`Idle_11` for chiefmonkey), unlike the full-body mirror model. Its empty hands
can swing into the view alongside the still-visible gun, even when idle.
The NAP mirror uses a different, full-body rig with a gun attached to RightHand;
changing that correct rig would not repair this first-person-only mismatch.

## Decision

The existing gun viewmodel owns the first-person weapon silhouette. The
headless body supplies torso and legs, not a second independently animated
pair of arms. At load time, filter arm-weighted triangles from a private copy
of its geometry index. Recognise arm chains and descendants (including fingers),
preserve material groups, and leave the original geometry untouched.

Do not hide the whole body, shrink bones, suppress the weapon, alter mirror/
peer poses, rebuild GLBs, download extra animation assets, or introduce a
per-frame vertex filter. First-person locomotion follows actual horizontal
displacement rather than raw keys, so blocked/gateway-paused players idle.

## Consequences and limits

The empty swinging hand cannot render on supported humanoid rigs. Chest/feet
remain visible on look-down; existing mirror/fly/portal visibility guards remain.
The full-body gun, aim, recoil and reload paths remain unchanged.
This deliberately does not add visible gun-gripping first-person arms or IK.
Any future visible-arm viewmodel must share the weapon transform and reload/
recoil timing; independently playing unarmed body clips is not an acceptable
fallback. Unknown skeleton naming is left unchanged rather than deleting an
unrecognised character's body.

## Verification

Behavioural tests cover indexed/non-indexed geometry, shared source isolation,
finger ancestry, joint aliases, material groups, blended weights, idempotence,
stationary/sprint-held, walk/run, jitter and teleport deltas. Real shipped
headless GLBs and browser gameplay must also be checked before release.
