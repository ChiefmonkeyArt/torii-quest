// engine/settings/characterForgePanel.js — pure HTML-string renderer for the
// "Character" settings tab (the Character Forge). Node-testable, no DOM at
// import time (mirrors profilePanel.js / gatewaySetupPanel.js shape).
//
// The Character Forge is the player-facing surface for creating/reading a
// character. v1 is validator-first: it first CHECKS whether the logged-in npub
// already has a character (a signed kind-35100 event — the "smooth experience"
// seam), and if not, offers the creation flow: an "Upload your own" card
// (upload-mesh — validated client-side via glbInspect + assessRig before the
// Blossom upload), and a "Create with AI" card that runs a LOCAL MOCK
// generation (see ADR-0091 — the real Meshy/routstr/Cashu backend is a later
// slice; the mock proves the prompt→validate→verdict loop).
// See nap-torii-avatar-v0.md and the Character Forge entry in strategy.md.
//
// renderCharacterForgePanel(state) — state:
//   isLoggedIn  — boolean; gates the whole tab.
//   status      — 'idle' | 'checking' | 'found' | 'none' | 'creating' | 'failed'.
//   character   — { name, meshName, stickerCount, stickers[] } | null (when 'found').
//   rig         — { verdict, convention, boneCount, note } | null — the last
//                 upload's assessed rig, surfaced inline (upload + found views).
//   ai          — { status:'idle'|'running'|'done', prompt, result } — the local
//                 "Create with AI" mock flow sub-state; when ai.status !== 'idle'
//                 the create view is replaced by _aiFlowView(ai).
//   error       — string | null (when status==='failed').
// Returns an HTML string. main.js wires the actions via the delegated 'click'
// pattern (data-action="check-character" / "upload-mesh" / "replace-character" /
// "generate-ai" / "ai-reset"). Stickers no longer live here — they have their
// own Settings tab (stickerPanel.js) as of v0.2.795-alpha.

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

// _rigVerdict(rig) — the upload rig-assessment verdict as a compact status
// line ("Rig OK" / "Rig warning"). `rig` is the summary from main.js's
// _summarizeRig() (verdict + convention + boneCount + note). Renders nothing
// when no rig is present, so it is safe to splice into any view.
function _rigVerdict(rig) {
  const r = (rig && typeof rig === 'object') ? rig : null;
  if (!r || typeof r.verdict !== 'string') return '';
  const ok = r.verdict === 'riggable';
  const cls = ok ? 'cf-rig-ok' : 'cf-rig-warn';
  const label = ok ? 'Rig OK' : 'Rig warning';
  const convention = (typeof r.convention === 'string' && r.convention && r.convention !== 'unknown')
    ? `${_escape(r.convention)} · ` : '';
  const bones = (typeof r.boneCount === 'number' && r.boneCount > 0) ? `${r.boneCount} bones` : 'no bones';
  const note = (!ok && r.note) ? ` <span class="cf-rig-note">${_escape(r.note)}</span>` : '';
  return `<div class="cf-rig ${cls}"><span class="cf-rig-label">${label}</span><span class="cf-rig-detail">${convention}${bones}</span>${note}</div>`;
}

// _foundView(character, rig) — the "found" state reads as a character summary
// card: a portrait-style circle (initial, since there's no real thumbnail
// yet), the name, and a clean stat row (mesh), plus a "Replace character"
// action. Stickers were moved to their OWN settings tab (v0.2.795-alpha) — the
// character card no longer shows a sticker count or an inline sticker editor.
// When a just-uploaded rig verdict is present it is shown below the card.
function _foundView(character, rig) {
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
        </div>
      </div>
    </div>
    ${_rigVerdict(rig)}
    <div class="cf-summary-actions">
      <button type="button" class="settings-btn settings-btn-primary" data-action="replace-character">Replace character</button>
    </div>`;
}

// _createView() — the character CREATE screen: two clearly separated,
// fully-framed creation paths — "Upload your own" (.glb, validated client-side
// via glbInspect + assessRig before the Blossom upload) and "Create with AI"
// (a LOCAL MOCK generator that runs prompt→validate→verdict with no backend;
// ADR-0091 reserves the real Meshy/routstr/Cashu wiring for a later slice).
// Both paths are always enabled: the earlier preset roster (select-preset) and
// its logged-out disabled gate were removed — creation is the only entry point.
function _createView() {
  return `
    <div class="settings-subtitle">Create your character — upload a rigged .glb, or generate one.</div>
    <div class="cf-create-grid">
      <div class="cf-create-card cf-upload-card">
        <div class="cf-create-card-title">Upload a character</div>
        <div class="cf-create-card-hint">Upload a rigged .glb with a compatible humanoid skeleton — it's validated before it's saved to your npub.</div>
        <button type="button" class="settings-btn" data-action="upload-mesh">Upload .glb</button>
      </div>
      <div class="cf-create-card cf-ai-card">
        <div class="cf-create-card-title">Create with AI</div>
        <div class="cf-create-card-hint">Describe your character and we'll generate a rigged mesh — validated automatically before it's saved to your npub.</div>
        <textarea id="cf-ai-prompt" class="settings-textarea cf-ai-prompt" rows="2" maxlength="400" placeholder="e.g. a low-poly fox knight in silver armour"></textarea>
        <button type="button" class="settings-btn settings-btn-primary" data-action="generate-ai">Generate</button>
        <div class="cf-ai-demo-note">Generate a humanoid from text (Meshy text-to-3D + auto-rig), then sign it to Blossom with your NIP-07 key.</div>
      </div>
    </div>`;
}

// _friendlyAiError(message) → { title, hint }. Maps the raw generation error
// (res.error from requestMeshGeneration) to copy a player can act on, instead of a
// bare "Something went wrong". 'no-session-token' / 'session required' are the
// common case: generation is session-gated, so a signed-out player hits them before
// the request ever leaves the browser (v0.2.787-alpha).
function _friendlyAiError(message) {
  const m = (typeof message === 'string') ? message.trim().toLowerCase() : '';
  if (m === 'no-session-token' || m === 'session required') {
    return { title: 'Sign in to generate', hint: 'AI character generation needs a Nostr session — sign in and try again.' };
  }
  if (m === 'generator unavailable') {
    return { title: 'Generator is offline', hint: 'This instance has not configured a Meshy API key.' };
  }
  if (m === 'prompt too long') {
    return { title: 'Description too long', hint: 'Keep your description under 400 characters.' };
  }
  if (m === 'generation failed') {
    return { title: 'Generation failed', hint: 'The 3D generator could not complete this character — try a different description.' };
  }
  if (m) return { title: 'Something went wrong', hint: message };
  return { title: 'Something went wrong', hint: '' };
}

// _aiFlowView(ai) — the "Create with AI" flow screen. Renders the thinking state
// while ai.status==='running', the payment sheet while 'payment' (paid character-
// creation — v0.2.785-alpha), then the gate verdict when 'done'. Purely
// presentational: main.js drives the status transitions and wires the actions
// (ai-reset / generate-ai-pay / generate-ai-copy / generate-ai-confirm).
function _aiFlowView(ai) {
  const a = (ai && typeof ai === 'object') ? ai : {};
  if (a.status === 'running') {
    return `
      <div class="cf-ai-flow cf-ai-running">
        <div class="cf-ai-spinner" aria-hidden="true"></div>
        <div class="cf-ai-flow-title">Generating character…</div>
        <div class="cf-ai-flow-hint">Running four Meshy passes (shape → texture → remesh → rig). This typically takes several minutes — please keep this tab open.</div>
      </div>`;
  }

  if (a.status === 'payment') {
    const amount = Number(a.amountSats) || 0;
    const hint = (a.result && typeof a.result.message === 'string') ? a.result.message : '';
    return `
      <div class="cf-ai-flow cf-ai-payment">
        <div class="cf-ai-flow-title">Pay to generate</div>
        <div class="cf-ai-flow-hint">This generation costs ${amount} sats and covers the operator's 3D-generation cost. Pay the invoice below and your character is generated instantly.</div>
        ${hint ? `<div class="cf-ai-flow-hint cf-ai-pay-hint">${_escape(hint)}</div>` : ''}
        <textarea class="settings-textarea cf-ai-invoice" rows="3" readonly>${_escape(a.invoice || '')}</textarea>
        <div class="cf-ai-pay-actions">
          <button type="button" class="settings-btn settings-btn-primary" data-action="generate-ai-pay">Pay ${amount} sats</button>
          <button type="button" class="settings-btn" data-action="generate-ai-copy">Copy invoice</button>
          <button type="button" class="settings-btn" data-action="generate-ai-confirm">I've paid</button>
        </div>
        <button type="button" class="settings-btn settings-btn-ghost" data-action="ai-reset">Cancel</button>
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
    // No verdict when the flow 'done'-failed (no planned mock result). Surface the
    // real error instead of a bare "Something went wrong" (v0.2.787-alpha).
    const friendly = _friendlyAiError(out.message);
    return `
      <div class="cf-ai-flow cf-ai-rejected">
        <div class="cf-ai-flow-title">${_escape(friendly.title)}</div>
        ${friendly.hint ? `<div class="cf-ai-flow-hint">${_escape(friendly.hint)}</div>` : ''}
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

  // Pre-login shows a friendly "Sign in with Nostr…" banner ABOVE the fully
  // rendered, always-enabled creation cards (Upload + AI), so the tab reads as
  // a real creation screen even before login instead of a blank gate wall.
  const gate = !isLoggedIn
    ? '<div class="settings-gate">Sign in with Nostr to save your character — you can still explore the creation options below.</div>'
    : '';
  const rig = (st.rig && typeof st.rig === 'object') ? st.rig : null;

  const ai = (st.ai && typeof st.ai === 'object') ? st.ai : {};
  const aiStatus = typeof ai.status === 'string' ? ai.status : 'idle';
  const aiActive = aiStatus !== 'idle';

  let body = '';
  if (aiActive) {
    body = _aiFlowView(ai);
  } else if (!isLoggedIn) {
    body = _createView();
  } else if (status === 'found' && st.character) {
    body = _foundView(st.character, rig);
  } else if (status === 'failed') {
    body = `<div class="settings-empty">${_escape(st.error || 'Could not load your character.')}</div>
      <button type="button" class="settings-btn" data-action="check-character">Retry</button>`;
  } else if (status === 'checking' || status === 'creating') {
    body = `${_rigVerdict(rig)}<div class="settings-empty">Working…</div>`;
  } else {
    body = _createView();
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
