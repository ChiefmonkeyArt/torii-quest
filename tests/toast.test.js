// @vitest-environment jsdom
// tests/toast.test.js — locks the toast module contract.
import { describe, it, expect, beforeEach } from 'vitest';
import { showToast, toastSuccess, toastError, toastInfo } from '../src/engine/ui/toast.js';

function makeDoc() {
  return document;
}

describe('showToast', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('lazily creates #torii-toast-layer and appends a toast', () => {
    const { el } = showToast('Saved.', { tone: 'success' });
    const layer = document.getElementById('torii-toast-layer');
    expect(layer).not.toBeNull();
    expect(el.parentNode).toBe(layer);
    expect(el.className).toBe('ts-toast');
    expect(el.dataset.tone).toBe('success');
    expect(el.textContent).toBe('Saved.');
  });

  it('defaults to info tone when tone is missing or invalid', () => {
    const a = showToast('Note');
    expect(a.el.dataset.tone).toBe('info');
    const b = showToast('Note', { tone: 'nonsense' });
    expect(b.el.dataset.tone).toBe('info');
  });

  it('supports success/error/info convenience helpers', () => {
    expect(toastSuccess('a').el.dataset.tone).toBe('success');
    expect(toastError('b').el.dataset.tone).toBe('error');
    expect(toastInfo('c').el.dataset.tone).toBe('info');
  });

  it('dismiss() marks the toast leaving', () => {
    const { el, dismiss } = showToast('x', { duration: 999999 });
    dismiss();
    expect(el.classList.contains('is-leaving')).toBe(true);
  });

  it('handles a document without body gracefully', () => {
    const noBody = { createElement: document.createElement.bind(document), getElementById: () => null, body: null };
    const r = showToast('x', { doc: noBody });
    expect(r.el).toBeNull();
    expect(typeof r.dismiss).toBe('function');
  });
});
