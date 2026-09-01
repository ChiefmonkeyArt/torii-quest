// engine/settings/characterForgePanel.js — pure HTML-string renderer for the
// "Character" settings tab (the Character Forge). Node-testable, no DOM at
// import time (mirrors profilePanel.js / gatewaySetupPanel.js shape).
//
// The Character Forge is the player-facing surface for creating/reading a
// character. v1 is validator-first: it first CHECKS whether the logged-in npub
// already has a character (a signed kind-35100 event — the "smooth experience"
// seam), and if not, offers the creation flow: a preset grid (select-preset),
// an "Upload your own" card (upload-mesh), and a disabled "Create with AI"
// placeholder card (see ADR-0091 — future Meshy/routstr/Cashu integration,
// no backend wired yet). See nap-torii-avatar-v0.md and the Character Forge
// entry in torii-quest-strategy.md.
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
// "edit-character" / "add-sticker" / "remove-sticker" / "done-edit"). The
// "create-with-ai" button is rendered disabled with NO handler wired in
// main.js — it is a placeholder slot only (see _createView below).

function _escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _statusBadge(status) {
  if (status === 'checking') return '<div class="settings-badge">Checking…</div>';
  if (status === 'found') return '<div class="settings-badge">Character found</div>';
  if (status === 'creating') return '<div class="settings-badge">Creating…</div>';
  if (status === 'failed') return '<div class="settings-badge">Something went wrong</div>';
  return '';
}

function _shortHash(hash) {
  const h = typeof hash === 'string' ? hash : '';
  return h.length <= 12 ? h : `${h.slice(0, 8)}…`;
}

// _initial(name) — a single uppercase letter for the portrait placeholder
// (no real avatar image exists yet; a clean initial reads better than a
// generic icon and costs nothing to compute).
function _initial(name) {
  const n = typeof name === 'string' ? name.trim() : '';
  return n ? n[0].toUpperCase() : '?';
}

// _foundView(character) — the "found" state reads as a character summary
// card: a portrait-style circle (initial, since there's no real thumbnail
// yet), the name, and a clean stat row (mesh / stickers), plus a single
// "Edit stickers" action. Replaces the old plain label/value rows.
function _foundView(character) {
  const c = character || {};
  const name = c.name || 'Unnamed';
  return `
    <div class="settings-subtitle">You already have a character.</div>
    <div class="cf-summary-card">
      <div class="cf-summary-portrait" aria-hidden="true">${_escape(_initial(name))}</div>
      <div class="cf-summary-body">
        <div class="cf-summary-name">${_escape(name)}</div>
        <div class="cf-summary-stats">
          <div class="cf-summary-stat">
            <span class="cf-summary-stat-value">${_escape(c.meshName || '—')}</span>
            <span class="cf-summary-stat-label">Mesh</span>
          </div>
          <div class="cf-summary-stat">
            <span class="cf-summary-stat-value">${Number(c.stickerCount) || 0}</span>
            <span class="cf-summary-stat-label">Stickers</span>
          </div>
        </div>
      </div>
    </div>
    <button type="button" class="settings-btn settings-btn-primary" data-action="edit-character">Edit stickers</button>`;
}

// _stickerEditor(stickers, library) — the sticker-placement editor (mode 'edit').
// Placed stickers render as a clean list (zone + short id) each with a Remove
// button; the curated library renders as its own labeled card with a small
// button grid, not a wall of undifferentiated buttons. The actual 3D
// placement (raycast → zone/u/v/rot) is a runtime step in main.js; here a
// new sticker lands on its recommended zone by default.
function _stickerEditor(stickers, library) {
  const rows = (Array.isArray(stickers) ? stickers : []).map((s, i) => {
    const st = s || {};
    const zone = (typeof st.zoneId === 'string' && st.zoneId) ? st.zoneId : 'unknown';
    return `<div class="cf-sticker-row">
      <span>${_escape(zone)} · ${_escape(_shortHash(st.hash))}</span>
      <button type="button" class="settings-btn settings-btn-ghost settings-btn-sm" data-action="remove-sticker" data-index="${i}">Remove</button>
    </div>`;
  }).join('');

  const lib = Array.isArray(library) ? library : [];
  const addButtons = lib.map((e) => {
    const id = (e && e.id) ? e.id : '';
    const label = (e && e.label) ? e.label : id;
    return `<button type="button" class="settings-btn" data-action="add-sticker" data-sticker="${_escape(id)}">${_escape(label)}</button>`;
  }).join('');

  return `
    <div class="settings-subtitle">Add stickers to your character.</div>
    <div class="cf-sticker-list">${rows || '<div class="settings-empty">No stickers yet.</div>'}</div>
    <div class="cf-sticker-library">
      <div class="settings-section-heading">Add a sticker</div>
      <div class="cf-sticker-grid">${addButtons || '<div class="settings-empty">No stickers available.</div>'}</div>
    </div>
    <button type="button" class="settings-btn settings-btn-primary" data-action="done-edit">Done</button>`;
}

// _presetGrid(presets) — the preset picker as a card grid (name + Select),
// not plain buttons in a row.
function _presetGrid(presets) {
  const list = Array.isArray(presets) ? presets : [];
  const cards = list.map((p) => {
    const id = (p && p.id) ? p.id : '';
    const label = (p && p.label) ? p.label : id;
    return `<button type="button" class="cf-preset-card" data-action="select-preset" data-preset="${_escape(id)}">
      <span class="cf-preset-thumb" aria-hidden="true">${_escape(_initial(label))}</span>
      <span class="cf-preset-name">${_escape(label)}</span>
      <span class="cf-preset-select">Select</span>
    </button>`;
  }).join('');
  return `<div class="cf-preset-grid">${cards || '<div class="settings-empty">No presets available.</div>'}</div>`;
}

// _createView(presets) — the character SELECT + CREATE screen: a preset
// grid, plus two clearly separated, fully-framed creation paths ("Upload
// your own" and "Create with AI" — the latter a disabled placeholder for the
// future Meshy-style routstr/Cashu integration, ADR-0091). The AI card's
// button is deliberately disabled and NOT wired in main.js — wiring it is
// out of scope for this pass; only the slot is real.
function _createView(presets) {
  return `
    <div class="settings-subtitle">Pick a character, or create your own.</div>
    ${_presetGrid(presets)}
    <div class="cf-create-grid">
      <div class="cf-create-card cf-upload-card">
        <div class="cf-create-card-title">Upload a character</div>
        <div class="cf-create-card-hint">Upload a rigged .glb file — it must include a compatible humanoid skeleton.</div>
        <button type="button" class="settings-btn" data-action="upload-mesh">Upload .glb</button>
      </div>
      <div class="cf-create-card cf-ai-card">
        <div class="cf-create-card-title">Create with AI</div>
        <div class="cf-create-card-hint">Describe your character and we'll generate a rigged mesh — validated automatically before it's saved to your npub.</div>
        <span class="cf-coming-soon">Coming soon</span>
        <button type="button" class="settings-btn" data-action="create-with-ai" disabled>Create with AI</button>
      </div>
    </div>`;
}

export function renderCharacterForgePanel(state = {}) {
  const st = (state && typeof state === 'object') ? state : {};
  const isLoggedIn = st.isLoggedIn === true;
  const status = typeof st.status === 'string' ? st.status : 'idle';

  const gate = !isLoggedIn
    ? '<div class="settings-gate">Log in with Nostr to create or load your character.</div>'
    : '';
  const mode = (st.mode === 'edit') ? 'edit' : 'view';

  let body = '';
  if (isLoggedIn) {
    if (status === 'found' && st.character) {
      body = (mode === 'edit')
        ? _stickerEditor(st.character.stickers, st.stickerLibrary)
        : _foundView(st.character);
    } else if (status === 'failed') {
      body = `<div class="settings-empty">${_escape(st.error || 'Could not load your character.')}</div>
        <button type="button" class="settings-btn" data-action="check-character">Retry</button>`;
    } else if (status === 'checking' || status === 'creating') {
      body = '<div class="settings-empty">Working…</div>';
    } else {
      body = _createView(st.presets);
    }
  }

  return `
    <div class="settings-header">
      <h2 class="settings-title">Character</h2>
      ${_statusBadge(status)}
    </div>
    <div class="settings-subtitle">Your playable character — portable across worlds via Nostr.</div>
    ${gate}
    ${body}`;
}
