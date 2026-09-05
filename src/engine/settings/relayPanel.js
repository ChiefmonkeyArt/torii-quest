// engine/settings/relayPanel.js — pure HTML-string renderer for the "Relay"
// settings tab (v0.5). Node-testable, no DOM at import time (mirrors
// gatewaySetupPanel.js / heartbeatPanel.js's shape exactly).
//
// Lets the node owner see which relay(s) their node currently publishes
// presence to, and add/remove entries. This is display + a single textarea
// input only — ALL validation, dedup, and persistence already lives in
// engine/presence/nodeRelays.js (setNodeRelays/getNodeRelays/readNodeRelays,
// re-exported via engine/menu/adminPrefs.js) and is reused as-is here, not
// duplicated. Relays are wss:// ONLY — that invariant is enforced in
// nodeRelays.js, not this renderer.
//
// renderRelayPanel(state) — state:
//   { isOwner, nodeRelays, nodeRelaysInput, relayHealth? }.
//   nodeRelays      — string[] of the currently VALIDATED wss relays in use
//                      (what the whole game connects to — reads + presence
//                      publish, ADR-0081). Every row carries a Remove button.
//   nodeRelaysInput — the raw stored string, shown pre-filled in the textarea
//                      so an owner editing the list sees exactly what's saved
//                      (including anything not yet valid), not a reformatted
//                      version.
//   relayHealth     — v0.2.774 addition. Optional { [url]: healthRecord } map
//                      where healthRecord shape is
//                      { opens, opensFailed, closes, messages, avgLatencyMs,
//                        sessions[], failStreak }. Rendered as a per-relay
//                      table + sparkline under the relay selection. Left
//                      undefined = section hidden (back-compat with the old
//                      caller shape).
// Returns an HTML string. main.js wires the save action via the same
// delegated 'click'/'submit' pattern already used for the other tabs
// (data-action="save-relays" reads the textarea and calls onSetNodeRelays).

function _escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// _relayRow(url) — one relay row with a Remove button (used for every relay,
// default starter or operator-configured alike).
function _relayRow(url) {
  return `
    <div class="settings-row-inline" data-relay="${_escape(url)}">
      <span class="settings-dot" aria-hidden="true"></span>
      <span class="settings-row-value">${_escape(url)}</span>
      <button type="button" class="settings-btn settings-btn-ghost settings-btn-sm" data-action="remove-relay" data-relay="${_escape(url)}" aria-label="Remove ${_escape(url)}">Remove</button>
    </div>`;
}

// _sparkline(sessions) — 60x16 inline SVG of the rolling session-open counts.
// Bars scale to the max value in the window; a series of zeros renders as a
// flat baseline. Pure HTML string, no external deps.
function _sparkline(sessions) {
  const arr = Array.isArray(sessions) ? sessions : [];
  if (!arr.length) return '<svg class="relay-sparkline" width="60" height="16" aria-hidden="true"><line x1="0" y1="14" x2="60" y2="14" stroke="currentColor" stroke-opacity="0.2" stroke-width="1"/></svg>';
  const max = Math.max(1, ...arr);
  const barW = 60 / arr.length;
  const bars = arr.map((v, i) => {
    const h = Math.max(1, Math.round((v / max) * 14));
    const x = (i * barW).toFixed(2);
    const y = 16 - h;
    const w = Math.max(0.5, barW - 0.5).toFixed(2);
    const opacity = v === 0 ? '0.2' : '0.8';
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="currentColor" fill-opacity="${opacity}"/>`;
  }).join('');
  return `<svg class="relay-sparkline" width="60" height="16" aria-hidden="true">${bars}</svg>`;
}

// _healthRow(url, rec) — one row of per-relay health stats. rec is the
// { opens, opensFailed, closes, messages, avgLatencyMs, sessions, failStreak }
// shape supplied by the caller (already computed from relayHealth.readHealth).
function _healthRow(url, rec) {
  const r = rec && typeof rec === 'object' ? rec : {};
  const opens = Number.isFinite(r.opens) ? r.opens : 0;
  const fails = Number.isFinite(r.opensFailed) ? r.opensFailed : 0;
  const messages = Number.isFinite(r.messages) ? r.messages : 0;
  const avgMs = Number.isFinite(r.avgLatencyMs) ? Math.round(r.avgLatencyMs) : null;
  const total = opens + fails;
  const successPct = total > 0 ? Math.round((opens / total) * 100) : null;
  const streak = Number.isFinite(r.failStreak) ? r.failStreak : 0;
  const flag = streak >= 3 ? ' data-degraded="true"' : '';
  const latencyText = avgMs != null ? `${avgMs}ms` : '—';
  const successText = successPct != null ? `${successPct}%` : '—';
  const spark = _sparkline(r.sessions);
  return `
    <div class="settings-row-inline settings-relay-health" data-relay="${_escape(url)}"${flag}>
      <span class="settings-row-value settings-relay-url">${_escape(url)}</span>
      <span class="settings-relay-stat" title="Successful opens / total attempts">${opens}/${total} <span class="settings-relay-stat-label">opens</span></span>
      <span class="settings-relay-stat" title="Success rate">${successText}</span>
      <span class="settings-relay-stat" title="Average connect latency">${latencyText}</span>
      <span class="settings-relay-stat" title="Frames received">${messages} <span class="settings-relay-stat-label">msg</span></span>
      <span class="settings-relay-spark" title="Successful opens per recent session">${spark}</span>
    </div>`;
}

// _healthSection(relayHealth) — the whole Relay health block. Empty state
// renders a friendly "no activity yet" hint so the caller doesn't need to
// gate on relayHealth being non-empty. Returns '' if relayHealth is undefined
// (back-compat with old callers).
function _healthSection(relayHealth) {
  if (relayHealth === undefined || relayHealth === null) return '';
  const entries = (typeof relayHealth === 'object' && !Array.isArray(relayHealth))
    ? Object.entries(relayHealth) : [];
  // Sort by success rate desc, then by opens desc — best performers first.
  entries.sort(([, a], [, b]) => {
    const aTot = (a.opens || 0) + (a.opensFailed || 0);
    const bTot = (b.opens || 0) + (b.opensFailed || 0);
    const aRate = aTot ? (a.opens || 0) / aTot : 0;
    const bRate = bTot ? (b.opens || 0) / bTot : 0;
    if (bRate !== aRate) return bRate - aRate;
    return (b.opens || 0) - (a.opens || 0);
  });
  const rows = entries.length
    ? entries.map(([url, rec]) => _healthRow(url, rec)).join('')
    : '<div class="settings-empty">No relay activity yet — connect to a world and stats will start recording here.</div>';
  return `
    <div class="settings-section-divider"></div>
    <div class="settings-header">
      <h3 class="settings-subtitle">Relay health</h3>
    </div>
    <div class="settings-subtitle-note">Per-relay activity from your recent sessions. Best performers first. Sparklines show successful opens per session.</div>
    <div class="settings-list settings-relay-health-list">${rows}</div>`;
}

export function renderRelayPanel(state = {}) {
  const st = (state && typeof state === 'object') ? state : {};
  const isOwner = st.isOwner === true;
  const nodeRelays = Array.isArray(st.nodeRelays) ? st.nodeRelays : [];
  const rawInput = typeof st.nodeRelaysInput === 'string' ? st.nodeRelaysInput : '';
  const gate = !isOwner
    ? '<div class="settings-gate">Log in as the node owner to change this.</div>'
    : '';

  const listHtml = nodeRelays.length
    ? nodeRelays.map(_relayRow).join('')
    : '<div class="settings-empty">No relays yet — add one below to publish presence.</div>';

  const healthHtml = _healthSection(st.relayHealth);

  return `
    <div class="settings-header">
      <h2 class="settings-title">Relay</h2>
    </div>
    <div class="settings-subtitle">Relays this node reads from and publishes to.</div>
    <div class="settings-list">${listHtml}</div>
    ${gate}
    <div class="settings-row">
      <label class="settings-label" for="rl-add-input">Add or edit relays (comma or newline separated)</label>
      <textarea id="rl-add-input" class="settings-textarea" rows="3" placeholder="wss://relay.example.com"${isOwner ? '' : ' disabled'}>${_escape(rawInput)}</textarea>
      <button type="button" class="settings-btn settings-btn-primary" data-action="save-relays"${isOwner ? '' : ' disabled'}>Save relays</button>
    </div>
    <div class="settings-note">This list drives both reads and presence publish.</div>
    ${healthHtml}`;
}
