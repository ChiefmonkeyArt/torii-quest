// engine/settings/stickerPanel.js — pure HTML-string renderer for the
// "Stickers" settings tab (node-testable, no DOM at import time — mirrors
// characterForgePanel.js / profilePanel.js).
//
// Stickers were moved OFF the Character Forge tab (v0.2.795-alpha) and into
// their own surface. They are collectible decals and an in-Nap-zone "soft
// weapon"/expression primitive for non-combat social activity — a future slice
// replaces arena bullets with stickers in Nap zones. For now this page is a
// simple browse/library + owned-count surface: the curated STICKER_LIBRARY and
// a "coming soon" note for collecting/placing. The library is injected (main.js
// maps STICKER_LIBRARY) so the renderer stays pure.
//
// renderStickerPanel(state) — state:
//   isLoggedIn    — boolean; gates the "your collection" copy.
//   library       — [{ id, label, hash, recommendedZone }] — curated stickers.
//   ownedCount    — number — stickers currently applied to the character (read-only).
// Returns an HTML string. No actions yet (this is a browse surface).

function _escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _shortHash(hash) {
  const h = typeof hash === 'string' ? hash : '';
  return h.length <= 12 ? h : `${h.slice(0, 8)}…`;
}

export function renderStickerPanel(state = {}) {
  const st = (state && typeof state === 'object') ? state : {};
  const isLoggedIn = st.isLoggedIn === true;
  const ownedCount = Number(st.ownedCount) || 0;

  const lib = Array.isArray(st.library) ? st.library : [];
  const cards = lib.map((s) => {
    const id = (s && s.id) ? s.id : '';
    const label = (s && s.label) ? s.label : id;
    const zone = (s && s.recommendedZone) ? s.recommendedZone : '';
    const hash = (s && s.hash) ? s.hash : '';
    return `<div class="cs-sticker-card">
      <div class="cs-sticker-glyph" aria-hidden="true">${_escape(label[0] ? label[0].toUpperCase() : '?')}</div>
      <div class="cs-sticker-meta">
        <div class="cs-sticker-label">${_escape(label)}</div>
        <div class="cs-sticker-detail">${zone ? `${_escape(zone)} · ` : ''}${_escape(_shortHash(hash))}</div>
      </div>
    </div>`;
  }).join('');

  const collection = isLoggedIn
    ? `<div class="cs-owned"><span class="cs-owned-value">${ownedCount}</span><span class="cs-owned-label">stickers placed</span></div>`
    : '<div class="settings-gate">Sign in with Nostr to collect and place stickers.</div>';

  return `
    <div class="settings-header">
      <h2 class="settings-title">Stickers</h2>
    </div>
    <div class="settings-subtitle">Collectible decals and your Nap-zone expression kit — replace bullets in social spaces.</div>
    ${collection}
    <div class="settings-section-heading">Library</div>
    <div class="cs-sticker-grid">${cards || '<div class="settings-empty">No stickers available yet.</div>'}</div>
    <div class="cs-sticker-note">Collecting and placing stickers in the world is coming next.</div>`;
}