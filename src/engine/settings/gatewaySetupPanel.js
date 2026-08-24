// engine/settings/gatewaySetupPanel.js — pure HTML-string renderer for the
// "Gateway Setup" settings tab (v0.3). Node-testable, no DOM at import time
// (mirrors instanceSettings.js's split of pure render logic from the DOM
// container it's mounted into).
//
// Migrated from the old 4-card homepageStub.js overlay, minus "Visit a Node"
// (dropped by design decision — in-world travel already has a home at the
// physical Torii Gateway inside the NAP zone, so a second UI-level node
// directory would be redundant). The remaining 3 cards are UNCHANGED
// behavior, just re-skinned as data-action rows instead of a DOM-builder
// overlay of their own:
//   1. Choose Blank             → onChooseWorld('gateway-blank')       (owner-only)
//   2. Use My World as Template → onChooseWorld('chiefmonkey-template') (owner-only)
//   3. Publish My Node          → onPublishNode()                      (owner-only)
//
// renderGatewaySetupPanel(state) — state: { isOwner, isLoggedIn, activeWorld,
// heartbeatStatus }. Returns an HTML string. main.js wires clicks via a single
// delegated 'click' listener on the settings content container, matching
// `data-action` (mirrors instance settings' data-action="close" / data-form
// pattern already in use).

const HEX64 = /^[0-9a-f]{64}$/;

function _escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CARDS = [
  { id: 'blank', icon: '⬜', label: 'Choose Blank', hint: 'Start from an empty gateway world.', action: 'choose-blank' },
  { id: 'template', icon: '🗺️', label: 'Use My World as Template', hint: 'Seed the gateway from your world.', action: 'choose-template' },
  { id: 'publish', icon: '📡', label: '', hint: 'Heartbeat presence (needs signer consent).', action: 'publish-node' },
];

// _publishLabel(heartbeatStatus) — a short, honest label reusing the existing
// heartbeat status string so blocked/paused states stay consistent with the
// heartbeat toggle elsewhere. Never invents a state.
function _publishLabel(heartbeatStatus) {
  const s = typeof heartbeatStatus === 'string' ? heartbeatStatus : 'off';
  if (s === 'off') return 'Publish my node presence (OFF)';
  if (s === 'live') return 'Publish my node presence (LIVE)';
  if (s === 'idle') return 'Publish my node presence (idle — awaiting first publish)';
  if (s === 'publishing') return 'Publishing…';
  if (s === 'stale') return 'Republish overdue (stale)';
  return `Publish my node presence (${s})`;
}

function _cardHtml(card, state) {
  const isOwner = state.isOwner === true;
  const enabled = isOwner; // all 3 remaining cards are owner-only
  const label = card.id === 'publish' ? _publishLabel(state.heartbeatStatus) : card.label;
  const btnLabel = card.id === 'publish' ? 'Toggle' : 'Choose';
  const gate = !enabled
    ? '<div class="gs-gate">Log in as the node owner to configure this node.</div>'
    : '';
  return `
    <div class="gs-card" data-card="${_escape(card.id)}">
      <div class="gs-icon">${card.icon}</div>
      <div class="gs-body">
        <div class="gs-label">${_escape(label)}</div>
        <div class="gs-hint">${_escape(card.hint)}</div>
        ${gate}
      </div>
      <button type="button" class="gs-btn" data-action="${_escape(card.action)}"${enabled ? '' : ' disabled'} aria-label="${_escape(card.label || label)}">${_escape(btnLabel)}</button>
    </div>`;
}

export function renderGatewaySetupPanel(state = {}) {
  const st = (state && typeof state === 'object') ? state : {};
  const isOwner = st.isOwner === true;
  const activeWorld = typeof st.activeWorld === 'string' && st.activeWorld !== '' ? st.activeWorld : null;
  const badge = activeWorld
    ? `● ACTIVE WORLD · ${_escape(activeWorld)}`
    : (isOwner ? '● NO ACTIVE WORLD (default)' : '● DEFAULT WORLD');

  const cardsHtml = CARDS.map((c) => _cardHtml(c, st)).join('');
  const note = !isOwner
    ? '<div class="gs-note">Owner actions need the node owner signed in. To visit another world, use the Torii Gateway inside the NAP zone.</div>'
    : '<div class="gs-note">To visit another world, use the Torii Gateway inside the NAP zone.</div>';

  return `
    <div class="gs-header">
      <h2 class="gs-title">Gateway Setup</h2>
      <div class="gs-badge">${badge}</div>
    </div>
    <div class="gs-subtitle">Choose your homepage world · publish presence</div>
    <div class="gs-list">${cardsHtml}</div>
    ${note}`;
}

export function _isHex64(s) { return HEX64.test(String(s || '')); }
