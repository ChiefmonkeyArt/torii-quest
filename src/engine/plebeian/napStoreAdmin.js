// ADR-0145 (v0.2.916): the owner's NAP store setting, from the browser console.
//   await ToriiDebug.napStore.preview({ seller: 'npub1…' })         another seller
//   await ToriiDebug.napStore.preview({ items: ['naddr1…', …] })   custom store
//   await ToriiDebug.napStore.preview({})                           back to your own shop
//   await ToriiDebug.napStore.publish({ … })                        sign (NIP-07) + publish
// publish() refuses unless the signer IS this world's owner, so nobody can set
// someone else's store, and nothing is ever signed without the extension prompt.
// Lazy-loaded only from the console helper.
import { npubToHex, naddrToCoord } from '../crypto/npub.js';
import { buildStoreEvent, parseStoreConfig } from './boardOwner.js';

export function previewStore({ owner, seller, items, nowSec } = {}) {
  if (!/^[0-9a-f]{64}$/.test(owner || '')) return { ok: false, errors: ['this world has no owner pubkey (torii-host-pubkey meta missing)'], event: null };
  const r = buildStoreEvent({ seller, items, nowSec, toHex: npubToHex, toCoord: naddrToCoord });
  const shows = r.event.tags.some((t) => t[0] === 'a') ? 'custom store: ' + r.event.tags.filter((t) => t[0] === 'a').length + ' item(s)'
    : (r.event.tags.find((t) => t[0] === 'p') ? 'seller ' + r.event.tags.find((t) => t[0] === 'p')[1].slice(0, 8) + '…' : 'your own shop');
  return { ...r, shows, signer: owner };
}

export async function publishStore({ owner, seller, items, sign, publish, getSignerPubkey }) {
  const p = previewStore({ owner, seller, items });
  if (!p.ok) return { ok: false, errors: p.errors };
  let who = '';
  try { who = String((await getSignerPubkey()) || '').toLowerCase(); } catch { /* no signer */ }
  if (who !== owner) return { ok: false, errors: [`signer ${who ? who.slice(0, 8) + '…' : '(none)'} is not this world's owner ${owner.slice(0, 8)}…`] };
  const s = await sign(p.event);
  if (!s || !s.ok || !s.event) return { ok: false, errors: ['signing cancelled or failed: ' + ((s && s.error) || 'unknown')] };
  if (!parseStoreConfig(s.event, owner)) return { ok: false, errors: ['signed event failed verification'] };
  const r = await publish(s.event);
  return { ok: !!(r && r.accepted), shows: p.shows, accepted: (r && r.accepted) || 0, failedRelays: (r && r.failed) || [] };
}
