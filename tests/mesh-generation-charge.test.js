// tests/mesh-generation-charge.test.js — the routstr/Cashu charge seam (Step C).
// Locks the executor's `charge(backend) => { ok }` contract: fail-closed pricing,
// invoice + melt-payment composition, truthful failure when a piece is unwired,
// and the Cashu NUT-05 melt-quote request shape.
import { describe, it, expect } from 'vitest';
import { createGenerationCharge, createCashuMeltPayment } from '../server/character/meshGenerationCharge.js';

describe('createGenerationCharge — payment composition', () => {
  it('fails closed (no-price) for an unpriced backend', async () => {
    const charge = createGenerationCharge({ price: () => 0 });
    const r = await charge({ id: 'meshy' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-price');
  });

  it('returns ok:true when invoice + cashu payment both succeed', async () => {
    const calls = {};
    const charge = createGenerationCharge({
      price: ({ id }) => (id === 'meshy' ? 7500 : 0),
      requestInvoice: async (a) => { calls.req = a; return { invoice: 'lnbc_bolt11' }; },
      payInvoice: async (a) => { calls.pay = a; return { ok: true, state: 'paid' }; },
    });
    const r = await charge({ id: 'meshy' });
    expect(r.ok).toBe(true);
    expect(r.amountSats).toBe(7500);
    expect(calls.req.amountSats).toBe(7500);
    expect(calls.pay.invoice).toBe('lnbc_bolt11');
  });

  it('returns payment-failed when the melt does not confirm', async () => {
    const charge = createGenerationCharge({
      price: () => 6000,
      requestInvoice: async () => ({ invoice: 'lnbc_x' }),
      payInvoice: async () => ({ ok: false, error: 'insufficient funds' }),
    });
    const r = await charge({ id: 'tripo' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('payment-failed');
    expect(r.detail).toBe('insufficient funds');
  });

  it('returns invoice-failed when no invoice source is wired', async () => {
    const charge = createGenerationCharge({ price: () => 6000 }); // defaults unwired
    const r = await charge({ id: 'tripo' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invoice-failed');
  });
});

describe('createCashuMeltPayment — NUT-05 melt quote', () => {
  it('fails closed without a mint url', async () => {
    const p = createCashuMeltPayment({ mintUrl: '' });
    const r = await p({ invoice: 'lnbc_x' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('cashu:missing-mint-url');
  });

  it('requests a melt quote with the invoice and returns quote id', async () => {
    const calls = [];
    const fetch = async (url, init = {}) => {
      calls.push({ url, method: init.method, body: init.body });
      return { ok: true, status: 200, json: async () => ({ quote: 'q1', amount: 6000, fee_reserve: 10 }) };
    };
    const p = createCashuMeltPayment({ mintUrl: 'https://mint.example', fetchFn: fetch });
    const r = await p({ invoice: 'lnbc_x', amountSats: 6000 });
    expect(r.ok).toBe(true);
    expect(r.quoteId).toBe('q1');
    expect(calls[0].url).toBe('https://mint.example/v1/melt/quote/sat');
    const body = JSON.parse(calls[0].body);
    expect(body.request).toBe('lnbc_x');
    expect(body.unit).toBe('sat');
  });

  it('surfaces a non-2xx mint response as an error', async () => {
    const fetch = async () => ({ ok: false, status: 400, json: async () => ({}) });
    const p = createCashuMeltPayment({ mintUrl: 'https://mint.example', fetchFn: fetch });
    const r = await p({ invoice: 'lnbc_x' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('cashu:melt-quote-400');
  });
});