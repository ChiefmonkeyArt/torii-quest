// engine/napplets/productPanelNappletSrcdoc.js — ADR-0058. PURE + node-safe: exports a
// JS string spliced into the world srcdoc bootstrap (via the extraScript hook) that
// renders the Plebeian auction bid list inside the sandboxed napplet iframe.
//
// SECURITY: builds DOM nodes with textContent only — NEVER innerHTML of untrusted
// data. The snapshot is structured JSON serialized by productNappletSnapshot.js
// (no Maps, no functions, no remote image URLs in v1). The CSP in nappletSrcdoc.js
// (connect-src 'none'; img-src 'none') means the iframe cannot fetch or load images
// even if a bug tried.
//
// The renderer registers window.napplet.world.on('world.surface.update', …) and renders
// data.snapshot when data.channel === 'plebeian.auction'. It also calls
// world.attach.get() on boot to prove the request/response round-trip end-to-end.

export const PRODUCT_NAPPLET_EXTRA_SCRIPT = `
(function(){
  var root = document.getElementById('root');
  function clear(){ while (root && root.firstChild) root.removeChild(root.firstChild); }
  function el(tag, txt, cls){
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = String(txt);
    return n;
  }
  function fmtClock(unix){
    if (!unix || unix <= 0) return '';
    var d = new Date(unix * 1000);
    return String(d.getUTCHours()).padStart(2,'0') + ':' + String(d.getUTCMinutes()).padStart(2,'0');
  }
  function render(snap, status){
    if (!root) return;
    clear();
    // The shell's legacy renderer still owns the panel header (title / summary /
    // chips / high / next / poster / link). This iframe owns ONLY the bid list + a
    // status footer — no duplicated header, no innerHTML of untrusted data.
    if (!snap) {
      root.appendChild(el('div', 'Waiting for relay…', 'pp-empty'));
      return;
    }
    var list = el('div', null, 'pp-list');
    var bids = snap.bids || [];
    if (!bids.length) {
      list.appendChild(el('div', 'No bids yet', 'pp-empty'));
    } else {
      for (var i = 0; i < bids.length; i++) {
        var b = bids[i];
        var row = el('div', null, 'pp-row' + (b.isTopBid ? ' top' : ''));
        var av = el('span', (b.bidder && b.bidder.initial) || '?', 'avatar');
        av.style.backgroundColor = 'hsl(' + ((b.bidder && b.bidder.hue) || 0) + ' 55% 45%)';
        row.appendChild(av);
        row.appendChild(el('span', fmtClock(b.time), 't'));
        var who = (b.bidder && b.bidder.name) ? b.bidder.name : '?';
        row.appendChild(el('span', who, 'who'));
        row.appendChild(el('span', (b.amount || 0).toLocaleString(), 'amt'));
        if (b.isTopBid) row.appendChild(el('span', 'high bid', 'flag'));
        else if (!b.isMonotonic) row.appendChild(el('span', 'below high', 'flag note'));
        list.appendChild(row);
      }
    }
    root.appendChild(list);
    var foot = el('div', null, 'pp-foot');
    foot.appendChild(el('span', 'watch-only · ' + (status || (snap.bidCount + ' bids')), 'pp-status'));
    root.appendChild(foot);
  }
  window.napplet.world.on('world.surface.update', function(data){
    if (!data || data.channel !== 'plebeian.auction') return;
    render(data.snapshot, data.status);
  });
  window.napplet.world.attach.get().then(function(){ /* mounted */ }).catch(function(){});
})();
`;
