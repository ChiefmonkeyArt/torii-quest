# ADR-0129: Presence liveness must tolerate reader clock skew

Status: accepted.

## Context

The gateway directory rendered "0 worlds online" on the operator's machine even
though both nodes were publishing fresh, valid presence to the shared relays. The
relay layer was healthy and a clean cloud session discovered both worlds, so the
drop was client-side.

The liveness check in `gatewayRead.js` (`_presenceLive`) compared the publisher's
NIP-40 `expiration` tag directly against the reader's `Date.now()`:

```js
if (expiration !== null) return expiration >= nowSec;
```

`expiration` and `created_at` are stamped by the publishing node's clock, while
`nowSec` is the reader's wall clock. A visitor whose clock runs ahead of the
publisher's sees a fresh node's `expiration` as already in the past, so every
world is rejected as stale — an empty directory that no hard refresh can fix
because the fault is the clock, not the cache.

## Decision

Liveness is no longer decided solely by `expiration >= nowSec`. When the
`expiration` tag reads as elapsed, the reader rescues the record by `created_at`
recency within the existing 1-hour grace window (`PRESENCE_GRACE_SEC`):

```js
if (expiration !== null) {
  if (expiration >= nowSec) return true;
  return created >= nowSec - PRESENCE_GRACE_SEC; // skew rescue
}
return created >= nowSec - PRESENCE_GRACE_SEC;
```

A node that published within the last hour stays listed even when its expiration
tag reads as just-elapsed on a skewed machine. A long-dead node (whose
`created_at` is older than the grace window) still drops. No new magic constant:
the rescue reuses the existing grace window, so the semantics stay auditable and
the stale-node horizon is unchanged at one hour.

## Consequences

- A fresh node is never dropped due to reader clock drift, fixing the empty
  directory for machines whose clock runs ahead.
- A node that has been offline for less than the grace window (up to one hour)
  may still appear live on a skewed reader; this is the accepted trade-off for
  never dropping a live node.
- The "drops expired presence" test was tightened to use a publisher that is also
  older than the grace window, and a new test locks the skew-rescue path.
