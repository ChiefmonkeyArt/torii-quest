// engine/settings/characterForgePanel.js — pure HTML-string renderer for the
// "Character" settings tab (the Character Forge). Node-testable, no DOM at
// import time (mirrors profilePanel.js / gatewaySetupPanel.js shape).
//
// The Character Forge is the player-facing surface for creating/reading a
// character. v1 is validator-first: it first CHECKS whether the logged-in npub
// already has a character (a signed kind-35100 event — the "smooth experience"
// seam), and if not, offers the creation flow (presets + stickers first;
// external mesh generation lands in a later slice). See nap-torii-avatar-v0.md
// and the Character Forge entry in torii-quest-strategy.md.
//
// renderCharacterForgePanel(state) — state:
//   isLoggedIn  — boolean; gates the whole tab.
//   status      — 'idle' | 'checking' | 'found' | 'none' | 'creating' | 'failed'.
//   character   — { name, meshName, stickerCount } | null (when status==='found').
//   presets     — [{ id, label }] — curated bases shown when status==='none'.
//   error       — string | null (when status==='failed').
// Returns an HTML string. main.js wires the actions via the delegated 'click'
// pattern (data-action="check-character" / "select-preset" / "upload-mesh").

function _escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _statusBadge(status) {
  if (status === 'checking') return '<div class="gs-badge">Checking for an existing character…</div>';
  if (status === 'found') return '<div class="gs-badge">Character found</div>';
  if (status === 'creating') return '<div class="gs-badge">Creating…</div>';
  if (status === 'failed') return '<div class="gs-badge">Something went wrong</div>';
  return '';
}

function _foundView(character) {
  const c = character || {};
  return `
    <div class="gs-subtitle">This npub already has a character — no setup needed.</div>
    <div class="cf-summary">
      <div class="cf-row"><span class="cf-label">Name</span><span class="cf-value">${_escape(c.name || 'Unnamed')}</span></div>
      <div class="cf-row"><span class="cf-label">Mesh</span><span class="cf-value">${_escape(c.meshName || '—')}</span></div>
      <div class="cf-row"><span class="cf-label">Stickers</span><span class="cf-value">${Number(c.stickerCount) || 0}</span></div>
    </div>
    <button type="button" class="gs-btn" data-action="edit-character">Edit character</button>`;
}

function _createView(presets) {
  const list = Array.isArray(presets) ? presets : [];
  const buttons = list.map((p) => {
    const id = (p && p.id) ? p.id : '';
    const label = (p && p.label) ? p.label : id;
    return `<button type="button" class="gs-btn cf-preset" data-action="select-preset" data-preset="${_escape(id)}">${_escape(label)}</button>`;
  }).join('');
  return `
    <div class="gs-subtitle">Create your character from a curated base, or upload your own mesh. External mesh generation lands in a later slice.</div>
    <div class="cf-presets">${buttons || '<div class="cf-empty">No presets available.</div>'}</div>
    <div class="cf-upload">
      <button type="button" class="gs-btn" data-action="upload-mesh">Upload custom mesh (.glb)</button>
    </div>`;
}

export function renderCharacterForgePanel(state = {}) {
  const st = (state && typeof state === 'object') ? state : {};
  const isLoggedIn = st.isLoggedIn === true;
  const status = typeof st.status === 'string' ? st.status : 'idle';

  const gate = !isLoggedIn
    ? '<div class="gs-gate">Log in with Nostr to create or load your character.</div>'
    : '';

  let body = '';
  if (isLoggedIn) {
    if (status === 'found' && st.character) {
      body = _foundView(st.character);
    } else if (status === 'failed') {
      body = `<div class="cf-empty">${_escape(st.error || 'Could not load your character.')}</div>
        <button type="button" class="gs-btn" data-action="check-character">Retry</button>`;
    } else if (status === 'checking' || status === 'creating') {
      body = '<div class="cf-empty">Working…</div>';
    } else {
      body = _createView(st.presets);
    }
  }

  return `
    <div class="gs-header">
      <h2 class="gs-title">Character</h2>
      ${_statusBadge(status)}
    </div>
    <div class="gs-subtitle">Your playable character in Torii — portable across worlds via Nostr.</div>
    ${gate}
    ${body}`;
}
