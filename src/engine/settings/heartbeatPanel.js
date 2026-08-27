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

import { isHeartbeatBroadcasting } from '../presence/heartbeat.js';

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
  if (s === 'idle') return 'Publish my node presence (on by default — starts on owner login)';
  if (s === 'publishing') return 'Publishing…';
  if (s === 'stale') return 'Republish overdue (stale)';
  return `Publish my node presence (${s})`;
}

// _isOnState(heartbeatStatus) — true only for statuses where a presence
// publish has ACTUALLY happened or been attempted (live/stale/publishing/
// paused). 'idle' (stored intent is 'on' but nothing has EVER published — the
// default state on a fresh install before the owner logs in; ADR-0077 auto-fires
// the first publish on owner login, so this is transient) intentionally renders
// as OFF, same as 'off' and the blocked states — a lit green "ON" switch that
// has never actually broadcast anything is misleading. Delegates to the shared
// isHeartbeatBroadcasting() so this can never drift out of sync with the
// toggle-direction decision in main.js / toriiMenu.js. Pure.
function _isOnState(heartbeatStatus) {
  return isHeartbeatBroadcasting(heartbeatStatus);
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
          <div class="gs-hint">Heartbeat is on by default — it auto-starts when the owner logs in (one signer approval may be asked).</div>
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
