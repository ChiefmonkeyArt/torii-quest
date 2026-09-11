// server/character/meshGenerationCharge.js — the routstr + Cashu payment seam
// for externally generated characters (Step C of the character-creation plan).
// SERVER-SIDE ONLY (like meshGenerationVendor.js): the melt/payment creds and
// the routstr invoice source never run in the browser. Node-safe + injectable —
// the actual wallet/mint/invoice calls cross injected functions, so the seam is
// testable with zero network and truthful when a piece is missing (it returns
// { ok:false, reason } instead of pretending a charge happened).
//
// Flow it models (matches the executor's `charge(backend) => {ok}` contract):
//   price(backend)            → sats cost for this vendor (injected — BTC price moves)
//   requestInvoice({sats})    → a BOLT11 invoice (routstr / the host's Lightning node)
//   payInvoice({invoice,sats})→ melt Cashu tokens to pay it (NUT-05), confirm
//
// Cashu NUT-05 (melt) grounding: request a melt quote, then melt proofs to it.
//   POST <mint>/v1/melt/quote/<unit>   { request: <bolt11>, unit:"sat" }  → quote (id, amount, fee)
//   POST <mint>/v1/melt/<quote_id>     { inputs: <proofs>, output?: ... } → { state, ... }
// See cashubtc.github.io/nuts/05/ (and NUT-04 for the mint-side pairing).

export const MESH_GENERATION_CHARGE_VERSION = 1;

// _sats(n) — clamp a numeric amount to a positive integer of sats.
function _sats(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  return v > 0 ? v : 0;
}

// createGenerationCharge({ price, requestInvoice, payInvoice }) → (backend) =>
//   Promise<{ ok, reason?, detail?, amountSats?, invoice?, payment? }>
// The executor injects this as its `charge`. Every piece is injectable so a
// missing routstr/cashu wiring degrades to a truthful failure instead of a
// silent charge.
export function createGenerationCharge({
  // Fail-closed default: the host injects the real sats price (never hardcode —
  // BTC moves; a Meshy text-to-3D full loop is roughly ~$0.76, but the sats
  // equivalent is computed at charge time). Returning 0 → 'no-price' → no charge.
  price = () => 0,
  requestInvoice = async () => ({ invoice: null, error: 'no-invoice-source (routstr not wired)' }),
  payInvoice = async () => ({ ok: false, error: 'no-cashu-payer (mint not wired)' }),
} = {}) {
  const getPrice = (typeof price === 'function') ? price : () => 0;
  const reqInv = (typeof requestInvoice === 'function') ? requestInvoice : async () => ({ invoice: null });
  const pay = (typeof payInvoice === 'function') ? payInvoice : async () => ({ ok: false });

  return async function charge(backend) {
    const info = (backend && typeof backend === 'object') ? backend : { id: (typeof backend === 'string' ? backend : '') };
    const amountSats = _sats(getPrice(info));
    if (!amountSats) return { ok: false, reason: 'no-price', amountSats: 0 };

    const inv = await reqInv({ amountSats, backendId: info.id });
    if (!inv || typeof inv.invoice !== 'string' || !inv.invoice) {
      return { ok: false, reason: 'invoice-failed', detail: (inv && inv.error) || null, amountSats };
    }

    const paid = await pay({ invoice: inv.invoice, amountSats, backendId: info.id });
    // F13: `ok:true` alone is NOT proof of settlement. The Cashu adapter returns
    // `{ ok:true, state:'quoted' }` after only requesting a melt QUOTE (NUT-05
    // step 1 — no proofs melted). Only a distinct verified-paid state authorizes
    // the vendor call, so a quote (or any non-paid state) fails closed here.
    const isPaid = !!(paid && paid.ok === true && paid.state === 'paid');
    const isQuoted = !!(paid && paid.state === 'quoted');
    return {
      ok: isPaid,
      reason: isPaid ? null : (isQuoted ? 'unpaid-quote-only' : 'payment-failed'),
      detail: (paid && paid.error) || null,
      amountSats,
      invoice: inv.invoice,
      payment: (paid && paid.state) ? { state: paid.state } : null,
    };
  };
}

// createCashuMeltQuote({ mintUrl, fetchFn }) → ({ invoice, amountSats }) =>
//   Promise<{ ok, state:'quoted', quoteId?, amount?, fee?, error? }>. The NUT-05
//   melt-QUOTE request (step 1 of 2): ask the mint what it would charge to route
//   the invoice. This is NOT payment — no proofs are melted, so callers must NOT
//   treat `ok:true` here as settlement. The proof submission (POST /v1/melt/<id>)
//   is a separate wallet step that yields the verified-paid state charge()
//   requires. Named "Quote" (not "Payment") to make that boundary explicit.
export function createCashuMeltQuote({ mintUrl, fetchFn = globalThis.fetch } = {}) {
  if (typeof mintUrl !== 'string' || !mintUrl) {
    return async () => ({ ok: false, error: 'cashu:missing-mint-url' });
  }
  const base = mintUrl.replace(/\/+$/, '');
  return async function meltQuoteRequest({ invoice, amountSats } = {}) {
    if (typeof invoice !== 'string' || !invoice) return { ok: false, error: 'cashu:missing-invoice' };
    let res;
    try {
      res = await fetchFn(`${base}/v1/melt/quote/sat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: invoice, unit: 'sat', ...(amountSats ? { amount: amountSats } : {}) }),
      });
    } catch (err) {
      return { ok: false, error: `cashu:melt-quote-error ${String((err && err.message) || err)}` };
    }
    if (!res || !res.ok) return { ok: false, error: `cashu:melt-quote-${res ? res.status : 'n/a'}` };
    let quote = {};
    try { quote = await res.json(); } catch { return { ok: false, error: 'cashu:bad-quote-response' }; }
    // A successful quote implies the mint can route the invoice. The actual
    // proof submission (POST /v1/melt/<id>) is the wallet's step; we surface the
    // quote so the host completes it without re-fetching.
    return { ok: true, state: 'quoted', quoteId: quote.quote || quote.id || '', amount: quote.amount ?? amountSats, fee: quote.fee_reserve ?? 0 };
  };
}