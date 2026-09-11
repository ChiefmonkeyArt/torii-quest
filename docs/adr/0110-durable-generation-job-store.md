# ADR-0110: Durable paid-generation job store (strand-proof + single-flight)

- **Status:** Accepted
- **Date:** 2026-09-11
- **Version:** v0.2.820-alpha
- **Deciders:** chiefmonkey
- **Related:** ADR-0108 (paid AI character creation), `server/character/meshyClient.js`, `server/character/lightningInvoice.js`, audit F02

## Context

ADR-0108 shipped a two-phase payment gate: `POST /mp/mesh/generate` mints a BOLT11
invoice and holds the prompt server-side in a **transient in-memory `Map`
(`pendingGenerations`) with a 15-minute TTL and a 512-entry cap that evicts the
oldest entry**; `POST /mp/mesh/generate/confirm` verifies settlement then runs
Meshy. The audit (F02) found five hazards in that map, all in a path where a
payer's sats are at stake:

1. **Not durable** — a restart wipes every pending invoice, stranding a payer who
   paid but had not yet confirmed.
2. **No single-flight** — `confirm` is `verifySettled` → `delete` → `generate`. Two
   concurrent confirms for one `generationId` both pass settlement and both run
   Meshy → double-spend of operator credits on a single invoice.
3. **Failure strands the payer** — the entry is deleted *before* generation, so an
   upstream Meshy error leaves a settled payer with a 502 and no way to retry
   (violates ADR-0108's R8 "no double-charge on upstream failure").
4. **Capacity eviction** can evict a paid-but-unconfirmed entry (silent 404).
5. **15-minute expiry** strands a payer who confirms late (408, no recourse).

## Decision

Replace the transient map with a **durable, bounded job-store state machine**
(`server/character/generationStore.js`) persisted to a **single JSON snapshot
written atomically** (write `.tmp`, then rename), with these states:

```
pending ──claim──► claimed ──Meshy ok──► completed {glbUrl}
   ▲                                     │
   └──────────── retryable ◄──Meshy err──┘
```

- **Atomic claim.** `claim(generationId)` is a synchronous compare-and-set
  `pending|retryable → claimed`. After the async `verifySettled` resolves, the
  CAS runs with no `await` in between, so a concurrent confirm loses the race and
  returns `409 generation in progress` instead of double-running. `completed` is
  never claimable.
- **Retry without re-charge.** A Meshy failure marks the record `retryable` while
  retaining the settled invoice + prompt. A re-confirm re-verifies the
  already-settled invoice (idempotent) and re-enters `claimed` — no second payment.
- **Idempotent re-confirm.** A `completed` record caches `glbUrl`; re-confirming
  returns it directly with no further Meshy call.
- **Strand-proof bounding.** Only never-claimed `pending` entries are
  volume-capped (`maxPending`, default 512) and swept after a TTL (15 min).
  `claimed`/`completed`/`retryable` (paid) entries are never evicted by the
  pending cap; they are retained for a generous `settledTtlMs` (24 h) before sweep,
  so a settled generation can always be re-confirmed/retried.

## Consequences

- **Enables:** restart-surviving pending invoices; no double-spend on a single
  invoice; a paid generation is always retryable on upstream failure; payers are
  never stranded by eviction or the pending TTL.
- **Trade-off:** the snapshot is written synchronously on each transition. It is a
  tiny, bounded object (hundreds of records max), so the block is negligible, and
  synchronous writes are what make the claim CAS atomic without a lock.
- **Enforcement:** `tests/generation-store.test.js` (18 tests) locks persistence,
  atomic claim (pending/retryable claimable, completed/claimed not), complete/fail,
  sweep (pending-only, settled TTL), pending-only eviction, and a source-level lock
  that `arena-ws.js` no longer holds a `pendingGenerations` Map.

## Alternatives considered

- **JSONL append-only log** (like `kami/replies.jsonl`) — rejected: append-only
  suits a monotonic feed, not in-place state transitions; a snapshot is the natural
  representation for a mutable job FSM.
- **Keep in-memory + a longer TTL / no eviction** — rejected: does not fix
  restart loss (hazard 1) nor double-spend (hazard 2); merely narrows hazards 4/5.
- **Out-of-process queue (Redis/etc.)** — rejected: a second dependency for a
  single bounded map is overkill at the current self-hosted scale; the snapshot
  keeps the operator dependency-free.