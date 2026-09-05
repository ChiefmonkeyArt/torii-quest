// engine/settings/characterForgePanel.js — pure HTML-string renderer for the
// "Character" settings tab (the Character Forge). Node-testable, no DOM at
// import time (mirrors profilePanel.js / gatewaySetupPanel.js shape).
//
// The Character Forge is the player-facing surface for creating/reading a
// character. v1 is validator-first: it first CHECKS whether the logged-in npub
// already has a character (a signed kind-35100 event — the "smooth experience"
// seam), and if not, offers the creation flow: a preset grid (select-preset),
// an "Upload your own" card (upload-mesh), and a "Create with AI" card that
// runs a LOCAL MOCK generation (see ADR-0091 — the real Meshy/routstr/Cashu
// backend is a later slice; the mock proves the prompt→validate→verdict loop).
// See nap-torii-avatar-v0.md and the Character Forge entry in strategy.md.
//
// renderCharacterForgePanel(state) — state:
//   isLoggedIn  — boolean; gates the whole tab.
//   status      — 'idle' | 'checking' | 'found' | 'none' | 'creating' | 'failed'.
//   character   — { name, meshName, stickerCount, stickers[] } | null (when 'found').
//   mode        — 'view' (default) | 'edit' — the 'edit' mode is the sticker editor.
//   stickerLibrary — [{ id, label }] — curated decals shown in the sticker editor.
//   presets     — [{ id, label }] — curated bases shown when status==='none'.
//   ai          — { status:'idle'|'running'|'done', prompt, result } — the local
//                 "Create with AI" mock flow sub-state; when ai.status !== 'idle'
//                 (and logged in) the create view is replaced by _aiFlowView(ai).
//   error       — string | null (when status==='failed').
// Returns an HTML string. main.js wires the actions via the delegated 'click'
// pattern (data-action="check-character" / "select-preset" / "upload-mesh" /
// "generate-ai" / "ai-reset" / "edit-character" / "add-sticker" /
// "remove-sticker" / "done-edit"). "generate-ai" runs the LOCAL MOCK
// generation flow (see _aiFlowView below); no real backend or signing is
// involved yet.

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
function _presetGrid(presets, opts) {
  const list = Array.isArray(presets) ? presets : [];
  const disabled = !!(opts && opts.disabled);
  const dAttr = disabled ? ' disabled' : '';
  const cards = list.map((p) => {
    const id = (p && p.id) ? p.id : '';
    const label = (p && p.label) ? p.label : id;
    return `<button type="button" class="cf-preset-card" data-action="select-preset" data-preset="${_escape(id)}"${dAttr}>
      <span class="cf-preset-thumb" aria-hidden="true">${_escape(_initial(label))}</span>
      <span class="cf-preset-name">${_escape(label)}</span>
      <span class="cf-preset-select">Select</span>
    </button>`;
  }).join('');
  return `<div class="cf-preset-grid">${cards || '<div class="settings-empty">No presets available.</div>'}</div>`;
}

// _createView(presets) — the character SELECT + CREATE screen: a preset
// grid, plus two clearly separated, fully-framed creation paths ("Upload
// your own" and "Create with AI" — the latter a LOCAL MOCK generator that
// runs prompt→validate→verdict with no backend; ADR-0091 reserves the real
// Meshy/routstr/Cashu wiring for a later slice).
function _createView(presets, opts) {
  // v0.2.739: the create view renders the SAME shell whether the user is
  // logged in or not. When logged out, every action button is disabled
  // (via `opts.disabled`) so people can still see what's on offer without
  // being blocked by an empty gate. `generate-ai` is disabled while logged
  // out (the mock flow ends in a "save to npub" step that needs a login).
  const disabled = !!(opts && opts.disabled);
  const uploadDisabled = disabled ? ' disabled' : '';
  const aiDisabled = disabled ? ' disabled' : '';
  const subtitle = disabled
    ? 'Preview the roster — sign in with Nostr to select or create.'
    : 'Pick a character, or create your own.';
  return `
    <div class="settings-subtitle">${subtitle}</div>
    ${_presetGrid(presets, { disabled })}
    <div class="cf-create-grid">
      <div class="cf-create-card cf-upload-card">
        <div class="cf-create-card-title">Upload a character</div>
        <div class="cf-create-card-hint">Upload a rigged .glb file — it must include a compatible humanoid skeleton.</div>
        <button type="button" class="settings-btn" data-action="upload-mesh"${uploadDisabled}>Upload .glb</button>
      </div>
      <div class="cf-create-card cf-ai-card">
        <div class="cf-create-card-title">Create with AI</div>
        <div class="cf-create-card-hint">Describe your character and we'll generate a rigged mesh — validated automatically before it's saved to your npub.</div>
        <textarea id="cf-ai-prompt" class="settings-textarea cf-ai-prompt" rows="2" maxlength="400" placeholder="e.g. a low-poly fox knight in silver armour"${aiDisabled}></textarea>
        <button type="button" class="settings-btn settings-btn-primary" data-action="generate-ai"${aiDisabled}>Generate demo</button>
        <div class="cf-ai-demo-note">Demo preview — real text-to-3D + auto-rig (Meshy/Tripo) wires up next.</div>
      </div>
    </div>`;
}

// _aiFlowView(ai) — the "Create with AI" mock flow screen (Step B). Renders the
// thinking state while ai.status==='running', then the gate verdict when 'done'
// (accepted / rejected / invalid prompt). Purely presentational: main.js drives
// the status transitions and wires the "Try again" (ai-reset) action. No real
// mesh, event, or signing is produced — it is a mock demonstration.
function _aiFlowView(ai) {
  const a = (ai && typeof ai === 'object') ? ai : {};
  if (a.status === 'running') {
    return `
      <div class="cf-ai-flow">
        <div class="cf-ai-flow-title">Generating character…</div>
        <div class="cf-ai-flow-hint">Demo — a real run would call Meshy/Tripo, auto-rig, then validate.</div>
      </div>`;
  }

  const out = (a.result && typeof a.result === 'object') ? a.result : {};
  if (out.planned === false) {
    return `
      <div class="cf-ai-flow cf-ai-rejected">
        <div class="cf-ai-flow-title">Couldn't start</div>
        <div class="cf-ai-flow-hint">Enter a description of your character (400 characters max), then try again.</div>
        <button type="button" class="settings-btn settings-btn-primary" data-action="ai-reset">Try again</button>
      </div>`;
  }

  const v = (out.verdict && typeof out.verdict === 'object') ? out.verdict : null;
  if (!v) {
    return `
      <div class="cf-ai-flow cf-ai-rejected">
        <div class="cf-ai-flow-title">Something went wrong</div>
        <button type="button" class="settings-btn settings-btn-primary" data-action="ai-reset">Try again</button>
      </div>`;
  }

  if (v.accepted) {
    return `
      <div class="cf-ai-flow cf-ai-accepted">
        <div class="cf-ai-flow-title">✓ Validated — ready to save</div>
        <div class="cf-ai-flow-hint">${_escape(v.rigConvention || 'humanoid')} rig · ${Number(v.rigBoneCount) || 0} bones · mapped to the Torii skeleton.</div>
        <div class="cf-ai-demo-note">Demo result — real generation uploads the mesh to Blossom and signs your kind-35100 character event (a later slice).</div>
        <button type="button" class="settings-btn settings-btn-primary" data-action="ai-reset">Try another</button>
      </div>`;
  }

  const reasons = (Array.isArray(v.reasons) ? v.reasons : []).join(' ');
  return `
    <div class="cf-ai-flow cf-ai-rejected">
      <div class="cf-ai-flow-title">Rejected</div>
      <div class="cf-ai-flow-hint">${_escape(reasons || 'Could not validate the generated mesh.')}</div>
      <button type="button" class="settings-btn settings-btn-primary" data-action="ai-reset">Try again</button>
    </div>`;
}

export function renderCharacterForgePanel(state = {}) {
  const st = (state && typeof state === 'object') ? state : {};
  const isLoggedIn = st.isLoggedIn === true;
  const status = typeof st.status === 'string' ? st.status : 'idle';

  // v0.2.739: pre-login now shows a friendly "Sign in with Nostr…" banner
  // ABOVE a fully-rendered but disabled preview (preset grid + Upload + AI
  // cards) so the tab reads as a real character-select screen even before
  // login, instead of a blank gate wall.
  const gate = !isLoggedIn
    ? '<div class="settings-gate">Sign in with Nostr to save your character. You can browse the roster below.</div>'
    : '';
  const mode = (st.mode === 'edit') ? 'edit' : 'view';

  const ai = (st.ai && typeof st.ai === 'object') ? st.ai : {};
  const aiStatus = typeof ai.status === 'string' ? ai.status : 'idle';
  const aiActive = isLoggedIn && aiStatus !== 'idle';

  let body = '';
  if (aiActive) {
    body = _aiFlowView(ai);
  } else if (!isLoggedIn) {
    body = _createView(st.presets, { disabled: true });
  } else if (status === 'found' && st.character) {
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

  return `
    <div class="settings-header">
      <h2 class="settings-title">Character</h2>
      ${_statusBadge(status)}
    </div>
    <div class="settings-subtitle">Your playable character — portable across worlds via Nostr.</div>
    ${gate}
    ${body}`;
}
