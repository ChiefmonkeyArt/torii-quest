// engine/settings/heartbeatPanel.js — pure HTML-string renderer for the
// "Heartbeat" settings tab (v0.3). Node-testable, no DOM at import time
// (mirrors gatewaySetupPanel.js's shape).
//
// Split out of gatewaySetupPanel.js's former 3rd card ("Publish My Node")
// per design direction: node-presence publishing is an operationally
// distinct concern from world choice, so it gets its own tab instead of
// being buried in the Gateway Setup card list. Behavior is UNCHANGED — same
// underlying state (main.js's heartbeatStatus()) and the same consent-publish
// callback (onPublishNode, reusing the menu's existing heartbeat toggle
// path) — only the presentation moved.
//
// renderHeartbeatPanel(state) — state: { isOwner, heartbeatStatus }. Returns
// an HTML string. main.js wires the single action via the same delegated
// 'click' listener on the settings content container (data-action=
// "publish-node", already registered for the old Gateway Setup card).

function _escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// _publishLabel(heartbeatStatus) — a short, honest label reusing the existing
// heartbeat status string so blocked/paused states stay consistent with the
// heartbeat toggle elsewhere. Never invents a state. (Unchanged from the
// former gatewaySetupPanel.js implementation.)
function _publishLabel(heartbeatStatus) {
  const s = typeof heartbeatStatus === 'string' ? heartbeatStatus : 'off';
  if (s === 'off') return 'Publish my node presence (OFF)';
  if (s === 'live') return 'Publish my node presence (LIVE)';
  if (s === 'idle') return 'Publish my node presence (idle — awaiting first publish)';
  if (s === 'publishing') return 'Publishing…';
  if (s === 'stale') return 'Republish overdue (stale)';
  return `Publish my node presence (${s})`;
}

// _isOnState(heartbeatStatus) — true for every status that represents the
// switch being ON (idle/live/stale/publishing/paused all mean intent==='on';
// only 'off' and the not-owner/no-signer/no-node-relay blocked states mean
// the switch itself is OFF). Used to drive the red/green switch visual
// independent of the more detailed text label. Pure.
function _isOnState(heartbeatStatus) {
  const s = typeof heartbeatStatus === 'string' ? heartbeatStatus : 'off';
  if (s === 'off' || s === 'blocked:not-owner' || s === 'blocked:no-signer' || s === 'blocked:no-node-relay') return false;
  return true;
}

export function renderHeartbeatPanel(state = {}) {
  const st = (state && typeof state === 'object') ? state : {};
  const isOwner = st.isOwner === true;
  const label = _publishLabel(st.heartbeatStatus);
  const on = _isOnState(st.heartbeatStatus);
  const gate = !isOwner
    ? '<div class="gs-gate">Log in as the node owner to configure this node.</div>'
    : '';

  return `
    <div class="gs-header">
      <h2 class="gs-title">Heartbeat</h2>
    </div>
    <div class="gs-subtitle">Publish this node's presence so other nodes can discover it</div>
    <div class="gs-list">
      <div class="gs-card" data-card="publish">
        <div class="gs-icon">📡</div>
        <div class="gs-body">
          <div class="gs-label">${_escape(label)}</div>
          <div class="gs-hint">Heartbeat presence (needs signer consent).</div>
          ${gate}
        </div>
        <button type="button" class="hb-switch ${on ? 'is-on' : 'is-off'}" data-action="publish-node"${isOwner ? '' : ' disabled'} role="switch" aria-checked="${on ? 'true' : 'false'}" aria-label="${_escape(label)}">
          <span class="hb-switch-track"><span class="hb-switch-knob"></span></span>
          <span class="hb-switch-state">${on ? 'ON' : 'OFF'}</span>
        </button>
      </div>
    </div>
    ${!isOwner ? '<div class="gs-note">Owner actions need the node owner signed in.</div>' : ''}`;
}
