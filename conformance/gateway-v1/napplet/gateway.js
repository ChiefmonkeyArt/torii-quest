// SPDX-License-Identifier: 0BSD
// Torii gateway napplet v1 — the doorway UI, and nothing else.
//
// Runs in <iframe sandbox="allow-scripts"> (opaque origin) with a CSP that denies
// all network. It has NO authority: it draws what the host sends and posts intents
// back. The host decides everything (which worlds exist, whether a peek is ready,
// whether 入 travels). Plain DOM: createElement + textContent; no HTML strings.
//
// Protocol (every message carries the per-mount nonce from the URL `#c=<nonce>`):
//   napplet → host  { type: 'gate.<action>', id, channelId, data }
//     gate.ready {}               mounted, send me state
//     gate.peek  { key }          the player clicked a row the host sent
//     gate.enter { confirm? }     the player pressed 入 / Enter (confirm: GO on a visit)
//     gate.stay  {}               STAY: back out of the "leave for <host>?" question
//     gate.close {}               ✕ / Escape
//     gate.key   { type, code }   a movement key while focus is in here
//     gate.size  { h }            the card's height in CSS px
//   host → napplet  { type, channelId, data }
//     gate.state   { sections: [{ title, empty, rows: [{ key, label, sub }] }], searching, canTravel }
//     gate.peek    { key, label, ready, mode, host, note, confirm }   (key '' clears it)
//                  mode 'enter' (Torii world, in place) | 'visit' (another engine:
//                  its website, host = hostname; confirm = the host is asking)
//     gate.arrival { kind: 'arrive'|'home', owner, world, npub }   (#m=arrival mount)
//     gate.preview { bitmap }              an ImageBitmap of the destination
//     gate.theme   { vars: { '--gw-accent': '#…', … } }
(function () {
  'use strict';
  var m = /^#c=([0-9a-z]{8,64})(?:&m=(arrival))?$/.exec(location.hash || '');
  var CID = m ? m[1] : '';
  var ARRIVAL = !!(m && m[2] === 'arrival');
  var host = window.parent;
  if (!CID || host === window) return; // not mounted by a host: stay inert

  var KEYS = { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, KeyF: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Space: 1, ShiftLeft: 1, ShiftRight: 1 };
  var THEME_KEYS = { '--gw-accent': 1, '--gw-accent-2': 1, '--gw-ink': 1, '--gw-text': 1, '--gw-soft': 1, '--gw-muted': 1, '--gw-dim': 1, '--gw-live': 1, '--gw-glass': 1, '--gw-edge': 1, '--gw-warn': 1 };
  var COLOUR = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/;
  var seq = 0;
  var peekKey = '';
  var ready = false;
  var visit = false;
  var asking = false;
  var NOTES = { 'other-engine': 'no Torii world found here: visiting opens its own site', 'enter-failed': 'could not build this world here: you can visit its site instead', 'visit-only': 'this world opens on its own site' };
  var $ = function (id) { return document.getElementById(id); };
  var card = $('card');
  var bitmapCtx = null;

  function send(action, data) {
    seq += 1;
    host.postMessage({ type: 'gate.' + action, id: seq, channelId: CID, data: data || {} }, '*');
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = String(text);
    return e;
  }
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }

  function markActive() {
    var rows = document.querySelectorAll('.row[data-key]');
    for (var i = 0; i < rows.length; i++) rows[i].classList.toggle('active', !!peekKey && rows[i].getAttribute('data-key') === peekKey);
  }

  function rowEl(r, canTravel) {
    var key = str(r && r.key, 128);
    var row = el(canTravel && key ? 'button' : 'div', 'row');
    row.setAttribute('data-key', key);
    if (canTravel && key) {
      row.type = 'button';
      row.setAttribute('data-click', '');
      row.setAttribute('aria-label', 'look at ' + str(r.label, 80));
      row.addEventListener('click', function () { send('peek', { key: key }); });
    } else {
      row.setAttribute('role', 'listitem');
    }
    var lab = el('div', 'lab');
    lab.append(el('div', 'name', str(r && r.label, 80) || '—'), el('div', 'sub', str(r && r.sub, 80) || '—'));
    row.append(el('div', 'dot'), lab);
    return row;
  }

  function renderState(d) {
    var cols = $('cols');
    cols.replaceChildren();
    var sections = Array.isArray(d.sections) ? d.sections.slice(0, 4) : [];
    var canTravel = d.canTravel === true;
    var any = false;
    if (d.searching === true) {
      cols.append(el('div', 'searching', 'Searching for live worlds…'));
    } else {
      for (var i = 0; i < sections.length; i++) {
        var s = sections[i] || {};
        var rows = Array.isArray(s.rows) ? s.rows.slice(0, 24) : [];
        var col = el('div', 'col');
        var head = el('div', 'col-head');
        head.append(el('div', 'col-title', str(s.title, 40)), el('div', 'col-count', String(Math.max(0, Math.min(9999, s.count | 0)) || rows.length)));
        col.append(head);
        if (!rows.length) col.append(el('div', 'empty', str(s.empty, 80)));
        for (var j = 0; j < rows.length; j++) { col.append(rowEl(rows[j], canTravel)); any = true; }
        cols.append(col);
      }
    }
    // v0.2.937: worlds with no way in (no world description, no website) sit in one
    // collapsed line, never as clickable rows.
    var un = d.unreachable && Array.isArray(d.unreachable.rows) ? d.unreachable.rows.slice(0, 24) : [];
    var box = $('unreach');
    box.replaceChildren();
    box.hidden = !un.length;
    if (un.length) {
      var det = el('details', '');
      det.append(el('summary', '', 'unreachable · ' + String(Math.max(un.length, Math.min(9999, d.unreachable.count | 0)))));
      for (var k = 0; k < un.length; k++) det.append(rowEl(un[k], false));
      box.append(det);
      det.addEventListener('toggle', reportSize);
    }
    $('note').hidden = canTravel || !any;
    markActive();
    reportSize();
  }

  function setPeek(d) {
    peekKey = str(d.key, 128);
    ready = !!peekKey && d.ready === true;
    var hostName = str(d.host, 253);
    visit = ready && d.mode === 'visit' && !!hostName;
    asking = visit && d.confirm === true;
    var label = str(d.label, 80);
    $('peek').hidden = !peekKey;
    $('looking').textContent = !peekKey ? '' : !ready ? 'finding ' + label + '…' : visit ? label + ' · ' + hostName : 'looking at ' + label;
    var enter = $('enter');
    enter.textContent = visit ? 'VISIT SITE ↗' : '入 · ENTER';
    enter.setAttribute('aria-label', visit ? 'Visit this world\'s site' : 'Enter this world');
    enter.disabled = !ready || asking;
    var note = visit ? (NOTES[d.note] || NOTES['other-engine']) : '';
    $('peeknote').textContent = note;
    $('peeknote').hidden = !note;
    $('confirm-q').textContent = asking ? 'Leave Torii Quest for ' + hostName + '?' : '';
    $('confirm').hidden = !asking;
    if (!peekKey || visit) $('preview').hidden = true;
    markActive();
    reportSize();
  }

  function drawPreview(bitmap) {
    if (!bitmap || typeof bitmap.width !== 'number' || !peekKey) { if (bitmap && bitmap.close) bitmap.close(); return; }
    var c = $('preview');
    if (c.width !== bitmap.width) c.width = bitmap.width;
    if (c.height !== bitmap.height) c.height = bitmap.height;
    if (!bitmapCtx) bitmapCtx = c.getContext('bitmaprenderer') || c.getContext('2d');
    if (!bitmapCtx) return;
    if (bitmapCtx.transferFromImageBitmap) bitmapCtx.transferFromImageBitmap(bitmap);
    else { bitmapCtx.drawImage(bitmap, 0, 0); if (bitmap.close) bitmap.close(); }
    if (c.hidden) { c.hidden = false; reportSize(); }
  }

  function applyTheme(d) {
    var vars = d && d.vars && typeof d.vars === 'object' ? d.vars : {};
    for (var k in vars) {
      if (Object.prototype.hasOwnProperty.call(vars, k) && THEME_KEYS[k] && typeof vars[k] === 'string' && COLOUR.test(vars[k])) {
        document.documentElement.style.setProperty(k, vars[k]);
      }
    }
  }

  var lastH = 0;
  function reportSize() {
    // The full content height (the host clamps the frame; the card scrolls inside it).
    var h = Math.ceil(card.scrollHeight + 2);
    if (h && h !== lastH) { lastH = h; send('size', { h: h }); }
  }

  $('close').addEventListener('click', function () { send('close'); });
  $('enter').addEventListener('click', function () { if (peekKey && ready && !asking) send('enter'); });
  $('go').addEventListener('click', function () { if (asking) send('enter', { confirm: true }); });
  $('stay').addEventListener('click', function () { if (asking) send('stay'); });

  function onKey(e) {
    if (e.type === 'keydown' && e.key === 'Escape') { e.preventDefault(); send(asking ? 'stay' : 'close'); return; }
    if (e.type === 'keydown' && e.key === 'Enter' && !(e.target && e.target.classList && (e.target.classList.contains('row') || e.target.id === 'stay'))) {
      e.preventDefault();
      if (asking) send('enter', { confirm: true }); else if (peekKey && ready) send('enter');
      return;
    }
    if (KEYS[e.code] && !e.repeat) { if (e.code === 'Space' || e.code.indexOf('Arrow') === 0) e.preventDefault(); send('key', { type: e.type, code: e.code }); }
  }
  if (!ARRIVAL) {
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keyup', onKey, true);
  }

  // ── the arrival card (#m=arrival): show, fade, then ask the host to remove us ──
  function showArrival(d) {
    var home = d.kind === 'home';
    var owner = str(d.owner, 80);
    var world = str(d.world, 80);
    $('arr-kicker').textContent = home ? '⛩ home again' : '入 arrived';
    $('arr-title').textContent = home ? 'your world' : (owner ? owner + '’s world' : 'a new world');
    $('arr-sub').textContent = home ? '' : [world, str(d.npub, 40)].filter(Boolean).join(' · ');
    var a = $('arrival');
    a.hidden = false;
    a.style.animation = 'none'; void a.offsetWidth; a.style.animation = ''; // restart the fade
    var h = Math.ceil(a.scrollHeight + 2);
    if (h) send('size', { h: h });
  }
  if (ARRIVAL) {
    card.hidden = true;
    $('arrival').addEventListener('animationend', function () { send('close'); });
  }

  window.addEventListener('message', function (ev) {
    if (ev.source !== host) return;
    var msg = ev.data;
    if (!msg || typeof msg !== 'object' || msg.channelId !== CID || typeof msg.type !== 'string') return;
    var d = msg.data && typeof msg.data === 'object' ? msg.data : {};
    if (ARRIVAL) { if (msg.type === 'gate.arrival') showArrival(d); else if (msg.type === 'gate.theme') applyTheme(d); return; }
    if (msg.type === 'gate.state') renderState(d);
    else if (msg.type === 'gate.peek') setPeek(d);
    else if (msg.type === 'gate.preview') drawPreview(d.bitmap);
    else if (msg.type === 'gate.theme') applyTheme(d);
  });

  if (!ARRIVAL && typeof ResizeObserver === 'function') new ResizeObserver(reportSize).observe(card);
  send('ready');
})();
