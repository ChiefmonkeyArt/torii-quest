// Torii Gate v1 reference world: everything a world needs, in plain JS.
import { FILTER, KIND, TOPIC, TTL_DEFAULT, readWorlds, visitUrl, readTraveller } from '../gate-v1.mjs';

const RELAYS = ['wss://relay.damus.io/', 'wss://nos.lol/'];
const ZONE = 'reference-world';
const $ = (id) => document.getElementById(id);
const status = (t) => { $('status').textContent = t; };

// §5 arrival: a CLAIM. To trust it, ask the visitor to log in with that key.
const arrived = readTraveller(location.href);
if (arrived.ok) $('arrival').textContent = `A traveller arrived claiming ${arrived.pubkey.slice(0, 12)}… (unverified until they log in).`;

function req(relay, filter, ms = 5000) {
  return new Promise((resolve) => {
    const out = []; let ws;
    const done = () => { try { ws.close(); } catch { /* closed */ } resolve(out); };
    try { ws = new WebSocket(relay); } catch { resolve(out); return; }
    const timer = setTimeout(done, ms);
    ws.onopen = () => ws.send(JSON.stringify(['REQ', 'gate', filter]));
    ws.onmessage = (m) => {
      let d; try { d = JSON.parse(m.data); } catch { return; }
      if (d[0] === 'EVENT' && d[1] === 'gate') out.push(d[2]);
      if (d[0] === 'EOSE') { clearTimeout(timer); done(); }
    };
    ws.onerror = () => { clearTimeout(timer); done(); };
  });
}

function publish(relay, ev) {
  return new Promise((resolve) => {
    let ws; try { ws = new WebSocket(relay); } catch { resolve(false); return; }
    const t = setTimeout(() => { try { ws.close(); } catch { /* closed */ } resolve(false); }, 5000);
    ws.onopen = () => ws.send(JSON.stringify(['EVENT', ev]));
    ws.onmessage = (m) => { let d; try { d = JSON.parse(m.data); } catch { return; } if (d[0] === 'OK') { clearTimeout(t); ws.close(); resolve(!!d[2]); } };
    ws.onerror = () => { clearTimeout(t); resolve(false); };
  });
}

let me = '';
// §2 heartbeat: publish now and every 10 minutes while the page is open.
async function heartbeat() {
  if (!window.nostr) { status('Install a NIP-07 signer to open your world.'); return; }
  me = me || await window.nostr.getPublicKey();
  const now = Math.floor(Date.now() / 1000);
  const content = { zoneId: ZONE, title: 'Reference world', description: 'Torii Gate v1, no engine', zoneType: 'gallery', website: location.origin + location.pathname, relays: RELAYS, topics: [], version: 1 };
  const ev = await window.nostr.signEvent({ kind: KIND, created_at: now, content: JSON.stringify(content),
    tags: [['d', ZONE], ['t', TOPIC], ['zoneType', 'gallery'], ['title', content.title], ...RELAYS.map((r) => ['relay', r]), ['expiration', String(now + TTL_DEFAULT)]] });
  const ok = (await Promise.all(RELAYS.map((r) => publish(r, ev)))).filter(Boolean).length;
  status(`Heartbeat accepted by ${ok}/${RELAYS.length} relays.`);
}
$('open').onclick = () => { heartbeat(); setInterval(heartbeat, 10 * 60 * 1000); };

// §3 reader + §4 travel.
$('scan').onclick = async () => {
  status('Scanning…');
  const events = (await Promise.all(RELAYS.map((r) => req(r, { ...FILTER, limit: 200 })))).flat();
  const worlds = readWorlds(events, { self: me });
  $('worlds').replaceChildren(...worlds.map((w) => {
    const li = document.createElement('li');
    li.textContent = `${w.displayName || w.title || w.owner.slice(0, 12)} (${w.zoneType || 'world'}) `;
    if (w.travellable) {
      const b = document.createElement('button');
      b.textContent = 'Travel';
      b.onclick = async () => {
        const traveller = window.nostr ? await window.nostr.getPublicKey() : '';
        const v = visitUrl(w.website, { traveller, zone: w.zoneType === 'nap' ? w.zoneId : '' });
        if (v.ok) location.href = v.url; else status('Refused: ' + v.error);
      };
      li.append(b);
    }
    return li;
  }));
  status(`${worlds.length} live worlds.`);
};
