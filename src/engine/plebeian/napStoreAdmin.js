// ADR-0145 (v0.2.916): the owner's NAP store setting, from the browser console.
//   await ToriiDebug.napStore.preview({ seller: 'npub1…' })         another seller
//   await ToriiDebug.napStore.preview({ items: ['naddr1…', …] })   custom store
//   await ToriiDebug.napStore.preview({})                           back to your own shop
//   await ToriiDebug.napStore.publish({ … })                        sign (NIP-07) + publish
// publish() refuses unless the signer IS this world's owner, so nobody can set
// someone else's store, and nothing is ever signed without the extension prompt.
// Every result carries a plain `message` line so the console shows what
// happened without expanding arrays. Lazy-loaded only from the console helper.
import { npubToHex, naddrToCoord } from '../crypto/npub.js';
import { buildStoreEvent, parseStoreConfig } from './boardOwner.js';

export function previewStore({ owner, seller, items, nowSec } = {}) {
  if (!/^[0-9a-f]{64}$/.test(owner || '')) return { ok: false, errors: ['this world has no owner pubkey (torii-host-pubkey meta missing)'], event: null };
  const r = buildStoreEvent({ seller, items, nowSec, toHex: npubToHex, toCoord: naddrToCoord });
  // v0.2.917: a failed preview must never claim a result ("your own shop").
  if (!r.ok) return { ok: false, errors: r.errors, event: null, shows: 'nothing: fix the value first, nothing was saved', message: 'Not saved: ' + r.errors.join('; '), signer: owner };
  const shows = r.event.tags.some((t) => t[0] === 'a') ? 'custom store: ' + r.event.tags.filter((t) => t[0] === 'a').length + ' item(s)'
    : (r.event.tags.find((t) => t[0] === 'p') ? 'seller ' + r.event.tags.find((t) => t[0] === 'p')[1].slice(0, 8) + '…' : 'your own shop');
  return { ...r, shows, message: 'Preview only (nothing sent). It would show ' + shows + '. Run publish with the same options to save it.', signer: owner };
}

export async function publishStore({ owner, seller, items, sign, publish, getSignerPubkey }) {
  const p = previewStore({ owner, seller, items });
  if (!p.ok) return { ok: false, errors: p.errors, message: p.message };
  let who = '';
  try { who = String((await getSignerPubkey()) || '').toLowerCase(); } catch { /* no signer */ }
  if (who !== owner) { const e = `signer ${who ? who.slice(0, 8) + '…' : '(none)'} is not this world's owner ${owner.slice(0, 8)}…`; return { ok: false, errors: [e], message: 'Not saved: ' + e }; }
  const s = await sign(p.event);
  if (!s || !s.ok || !s.event) { const e = 'signing cancelled or failed: ' + ((s && s.error) || 'unknown'); return { ok: false, errors: [e], message: 'Not saved: ' + e }; }
  if (!parseStoreConfig(s.event, owner)) return { ok: false, errors: ['signed event failed verification'], message: 'Not saved: signed event failed verification' };
  const r = await publish(s.event);
  const accepted = (r && r.accepted) || 0;
  return { ok: !!accepted, shows: p.shows, accepted, failedRelays: (r && r.failed) || [], message: accepted ? `Saved to ${accepted} relay(s). The NAP store now shows ${p.shows}.` : 'Not saved: no relay accepted it' };
}
