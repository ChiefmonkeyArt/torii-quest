// tests/lightning-invoice.test.js — the LNURL-pay client for paid character
// creation (server/character/lightningInvoice.js), exercised with an injected
// fetch. No network, no nodes.

import { describe, it, expect } from 'vitest';
import { createLightningInvoice } from '../server/character/lightningInvoice.js';

const okJson = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj });

describe('createLightningInvoice — resolveLightningAddress', () => {
  it('rejects a malformed lud16', async () => {
    const li = createLightningInvoice({ fetchFn: async () => okJson({}) });
    const r = await li.resolveLightningAddress('not-an-address');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid-lud16');
  });

  it('resolves user@domain to a payRequest callback', async () => {
    const log = [];
    const li = createLightningInvoice({
      fetchFn: async (url) => {
        log.push(url);
        return okJson({ tag: 'payRequest', callback: 'https://ln.example/lnurlp/alice', minSendable: 1000, maxSendable: 1000000000 });
      },
    });
    const r = await li.resolveLightningAddress('alice@ln.example');
    expect(r.ok).toBe(true);
    expect(r.callback).toBe('https://ln.example/lnurlp/alice');
    expect(log[0]).toBe('https://ln.example/.well-known/lnurlp/alice');
  });

  it('fails when the host does not return a payRequest', async () => {
    const li = createLightningInvoice({ fetchFn: async () => okJson({ tag: 'other' }) });
    const r = await li.resolveLightningAddress('alice@ln.example');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('not-a-payRequest');
  });
});

describe('createLightningInvoice — mintInvoice', () => {
  it('mints a BOLT11 invoice for the sats amount in millisats', async () => {
    const log = [];
    const li = createLightningInvoice({
      fetchFn: async (url) => {
        log.push(url);
        if (url.includes('/.well-known/lnurlp/')) {
          return okJson({ tag: 'payRequest', callback: 'https://ln.example/lnurlp/alice' });
        }
        return okJson({ pr: 'lnbc1invoice' });
      },
    });
    const r = await li.mintInvoice({ lud16: 'alice@ln.example', amountSats: 1369 });
    expect(r.ok).toBe(true);
    expect(r.pr).toBe('lnbc1invoice');
    expect(log[log.length - 1]).toContain('amount=1369000'); // millisats
  });

  it('fails closed on a zero amount', async () => {
    const li = createLightningInvoice({ fetchFn: async () => okJson({}) });
    const r = await li.mintInvoice({ lud16: 'alice@ln.example', amountSats: 0 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('zero-amount');
  });

  it('fails when the invoice endpoint returns no pr', async () => {
    const li = createLightningInvoice({
      fetchFn: async (url) => (url.includes('/.well-known/')
        ? okJson({ tag: 'payRequest', callback: 'https://ln.example/cb' })
        : okJson({})),
    });
    const r = await li.mintInvoice({ lud16: 'alice@ln.example', amountSats: 100 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('no-invoice');
  });
});

describe('createLightningInvoice — verifySettled', () => {
  it('uses an explicit verify URL when provided', async () => {
    const log = [];
    const li = createLightningInvoice({
      fetchFn: async (url) => { log.push(url); return okJson({ settled: true, preimage: 'abc' }); },
    });
    const r = await li.verifySettled({ lud16: 'alice@ln.example', pr: 'lnbc1', verifyUrl: 'https://ln.example/verify?pr=lnbc1' });
    expect(r.settled).toBe(true);
    expect(r.preimage).toBe('abc');
    expect(log[0]).toBe('https://ln.example/verify?pr=lnbc1');
  });

  it('fails closed (settled false) when the check returns not settled', async () => {
    const li = createLightningInvoice({ fetchFn: async () => okJson({ settled: false }) });
    const r = await li.verifySettled({ lud16: 'alice@ln.example', pr: 'lnbc1', verifyUrl: 'https://ln.example/verify?pr=lnbc1' });
    expect(r.settled).toBe(false);
  });

  it('fails closed when the response omits a settled flag', async () => {
    const li = createLightningInvoice({ fetchFn: async () => okJson({}) });
    const r = await li.verifySettled({ lud16: 'alice@ln.example', pr: 'lnbc1', verifyUrl: 'https://ln.example/verify' });
    expect(r.settled).toBe(false);
    expect(r.error).toBe('not-settled');
  });

  it('resolves the address for the fallback verify URL when no verifyUrl given', async () => {
    const log = [];
    const li = createLightningInvoice({
      fetchFn: async (url) => {
        log.push(url);
        if (url.includes('/.well-known/lnurlp/')) {
          return okJson({ tag: 'payRequest', callback: 'https://ln.example/lnurlp/alice' });
        }
        return okJson({ settled: true });
      },
    });
    const r = await li.verifySettled({ lud16: 'alice@ln.example', pr: 'lnbc1' });
    expect(r.settled).toBe(true);
    expect(log[log.length - 1]).toBe('https://ln.example/lnurlp/alice?pr=lnbc1');
  });
});