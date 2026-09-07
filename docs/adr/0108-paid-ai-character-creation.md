# ADR-0108: Paid AI character creation (Lightning address + NIP-57 zaps)

- **Status:** Accepted
- **Date:** 2026-09-07
- **Version:** v0.2.785-alpha
- **Deciders:** chiefmonkey
- **Related:** ADR-0091 (Character Forge — validator-first), ADR-0087 (validator-gated external mesh generation), ADR-0089 (generator clients), `server/character/meshyClient.js`, `server/character/meshGenerationCharge.js`, `server/character/meshGenerationExecutor.js`

## Context

`POST /mp/mesh/generate` (v0.2.784-alpha) made "Create with AI" real — a live Meshy
text-to-3D → refine → auto-rig round-trip served through a server proxy so the
operator's `MESHY_API_KEY` never reaches the browser. But it was gated only on a
valid Nostr session: any signed-in visitor could spend the operator's Meshy
credits (~$0.76–$1.00 per generation). Fine for a two-person playtest; an open tap
at public launch.

Two hard constraints drove the shape of the fix:

1. **No self-hosted Lightning node** (yet). LNbits/LND/CLN are future work — the
   receiver must be a *hosted* Lightning address (Alby/Strike/WoS).
2. **Per-instance opt-in, exactly like `MESHY_API_KEY`.** The key is read only
   from the VPS environment, absent from every installer/compose default, so a
   default install disables the feature. Payment must follow the same pattern:
   every operator sets their own price and their own receiver.

The codebase already carried the payment *seams* from ADR-0087/0089 —
`meshGenerationCharge.js` (price → invoice → confirm) and
`meshGenerationExecutor.js` (the `charge` step) — but both were unwired, and their
composition (generate-before-charge, single-shot mint+pay) did not match the
serve-held "pay then generate" flow.

routstr (Nostr + Cashu, pay-per-request) was considered first. It is a
buyer-side reverse proxy for **OpenAI-compatible LLM inference**; Meshy text-to-3D
is not token-in/token-out LLM, so routstr cannot meter it, and its invoice endpoint
is for topping up a routstr key — not for settling arbitrary payments *to* an
operator. It stays the future privacy upgrade; it is not the receiving rail.

## Decision

Add a **two-phase, operation-defined payment gate** around the existing Meshy
proxy, using **raw LNURL-pay (LUD-06) invoice + verify** as the P0 rail, with
**NIP-57 zap receipts** reserved as the P1 robustness upgrade:

1. **Price + receiver are per-instance env vars.** `MESH_GEN_PRICE_SATS` (integer;
   `0`/unset = operator-paid, unchanged behaviour) and `MESH_GEN_LUD16` (the
   operator's hosted lightning address). A price > 0 with no address fails closed
   (`503 payment unconfigured`).
2. **Phase 1 — mint.** `POST /mp/mesh/generate {prompt}` mints a BOLT11 invoice
   for the price from the operator's address via a new `server/character/lightningInvoice.js`
   (`resolveLightningAddress` → `mintInvoice`), holds the prompt server-side in a
   bounded, expiring map, and returns `{ requirePayment, generationId, invoice, amountSats }`.
3. **Phase 2 — confirm.** `POST /mp/mesh/generate/confirm {generationId}` verifies
   settlement (`verifySettled`), then calls Meshy. The prompt is never re-supplied
   by the client, so a confirm cannot substitute a different prompt. Unpaid /
   unknown / expired / another-session generations are `402` / `404` / `408` —
   and **Meshy is never called before settlement**. This is fail-closed: a flaky
   verify can block a generation, never mint a free one.
4. **Client.** `requestMeshGeneration()` surfaces the `requirePayment` shape and
   a new `confirmMeshGeneration(generationId)`; `main.js` pauses the forge on a
   payment sheet (one-tap `window.webln`, plus a copyable invoice + "I've paid").

The verify endpoint is the de-facto `lnurlpay` convention (`{callback}?pr={invoice}`),
with a mint-provided `verify` URL taking precedence; it is operator-tunable and
documented as such, because LUD-06 does not define a universal payee-side settle
check.

## Consequences

- **Enables:** operators to cover Meshy cost and take margin, per-instance and
  without running a node; closed testing stays free (`MESH_GEN_PRICE_SATS=0`);
  the gate is a drop-in for any future operator.
- **Forecloses:** routstr/Cashu and multi-backend (Tripo/Hunyuan) billing in this
  milestone — deferred, not removed. The existing `meshGenerationCharge.js` /
  `meshGenerationExecutor.js` seams are left unwired pending that consolidation.
- **Trade-offs:** LNURL-pay verify semantics vary by host (LNbits/Alby/Strike);
  fail-closed means a misconfigured receiver shows an error rather than shipping.
  A hosted lightning address is custodial (acceptable for MVP; swaps to
  self-hosted later).
- **Enforcement:** `tests/lightning-invoice.test.js` locks resolve/mint/verify
  (millisat amounts, fail-closed no-pr / zero-amount / not-settled, verify-URL
  precedence + fallback); `tests/live-mesh-generation.test.js` locks the
  `requirePayment` shape and `confirmMeshGeneration` contract. The route behaviour
  is covered by the arena-ws route tests.

## Alternatives considered

- **routstr + Cashu** — rejected for this milestone: buyer-side LLM proxy; does not
  fit a non-LLM text-to-3D vendor nor "receive sats from visitors" (see Context).
- **Self-hosted node / LNbits** — rejected: violates the "no node yet" constraint;
  revisited later.
- **NIP-57 zap receipts (kind 9735) as the P0 verification** — deferred to P1:
  more Nostr-native and verifiable without a node, but needs relay-watch plumbing
  beyond the P0 scope; the P0 LNURL-pay invoice + verify is the minimal
  cost-covering slice.
- **Operator-paid with no gate** — rejected: the exact open tap this ADR closes.

## Notes

- The prior `meshGenerationCharge.js` single-shot `charge(backend) => {ok}` shape
  and the executor's generate-before-charge ordering did not fit pay-first; the
  route composes `lightningInvoice.js` directly rather than shoehorning two phases
  into that seam. A later efficiency pass reconciles the duplicate Meshy clients
  (`meshyClient.js` wired vs `meshGenerationVendor.js` unwired) and the unwind seam.
- Launch price reference: `MESH_GEN_PRICE_SATS=1369` (covers ~$0.85/generation +
  a small margin at current BTC), set by the operator on the VPS alongside
  `MESH_GEN_LUD16` and `MESHY_API_KEY`.