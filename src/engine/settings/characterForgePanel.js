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
//   character   — { name, meshName, stickerCount, stickers[] } | null (when 'found').
//   mode        — 'view' (default) | 'edit' — the 'edit' mode is the sticker editor.
//   stickerLibrary — [{ id, label }] — curated decals shown in the sticker editor.
//   presets     — [{ id, label }] — curated bases shown when status==='none'.
//   error       — string | null (when status==='failed').
// Returns an HTML string. main.js wires the actions via the delegated 'click'
// pattern (data-action="check-character" / "select-preset" / "upload-mesh" /
// "edit-character" / "add-sticker" / "remove-sticker" / "done-edit").

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

function _shortHash(hash) {
  const h = typeof hash === 'string' ? hash : '';
  return h.length <= 12 ? h : `${h.slice(0, 8)}…`;
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
    <button type="button" class="gs-btn" data-action="edit-character">Edit stickers</button>`;
}

// _stickerEditor(stickers, library) — the sticker-placement editor (mode 'edit').
// Lists the character's stickers (zone + short hash + u/v/rot) each with a
// Remove button, and offers the curated sticker library to add one. The actual
// 3D placement (raycast → zone/u/v/rot) is a runtime step in main.js; here a
// new sticker lands on its recommended zone by default.
function _stickerEditor(stickers, library) {
  const rows = (Array.isArray(stickers) ? stickers : []).map((s, i) => {
    const st = s || {};
    const zone = (typeof st.zoneId === 'string' && st.zoneId) ? st.zoneId : 'unknown';
    const u = (Number(st.u) || 0).toFixed(2);
    const v = (Number(st.v) || 0).toFixed(2);
    const rot = (Number(st.rot) || 0).toFixed(1);
    return `<div class="cf-sticker-row">
      <span class="cf-value">${_escape(zone)} · ${_escape(_shortHash(st.hash))} · u ${u} / v ${v} / rot ${rot}</span>
      <button type="button" class="gs-btn" data-action="remove-sticker" data-index="${i}">Remove</button>
    </div>`;
  }).join('');

  const lib = Array.isArray(library) ? library : [];
  const addButtons = lib.map((e) => {
    const id = (e && e.id) ? e.id : '';
    const label = (e && e.label) ? e.label : id;
    return `<button type="button" class="gs-btn cf-preset" data-action="add-sticker" data-sticker="${_escape(id)}">${_escape(label)}</button>`;
  }).join('');

  return `
    <div class="gs-subtitle">Attach stickers to your character — saved to your signed character event.</div>
    <div class="cf-stickers">${rows || '<div class="cf-empty">No stickers yet.</div>'}</div>
    <div class="cf-add">
      <div class="cf-label">Add sticker</div>
      ${addButtons || '<div class="cf-empty">No stickers available.</div>'}
    </div>
    <button type="button" class="gs-btn" data-action="done-edit">Done</button>`;
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
  const mode = (st.mode === 'edit') ? 'edit' : 'view';

  let body = '';
  if (isLoggedIn) {
    if (status === 'found' && st.character) {
      body = (mode === 'edit')
        ? _stickerEditor(st.character.stickers, st.stickerLibrary)
        : _foundView(st.character);
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
