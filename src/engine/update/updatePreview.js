// engine/update/updatePreview.js — visible-but-inert torii.quest update-check
// PREVIEW block (LEAN-5, v0.2.142). Flattens the updateCheck view-model into a
// render-ready block of label/value rows that a title-screen or HUD card can draw
// directly — the running version, the latest GitHub release sample, the
// update-available / up-to-date / unknown status, and the GitHub releases path —
// all framed with an explicit "PREVIEW · MANUAL · NO AUTO-UPDATE" badge.
//
// Pure + node-safe: NO network fetch (NO fetch/XHR/WebSocket), NO auto-update, NO
// install, NO shell execution, NO navigation, NO Three/Rapier/DOM. This is the
// presentation layer over updateCheck.updateCheckView: it only re-shapes that
// helper's pure view-model into display strings. Every block carries
// `actionable: false` / `readOnly: true`; the actual read-only GitHub fetch and a
// real "Update" affordance stay separate, audited, MANUAL host steps (see
// UPDATE_CHECK.md §3 and HANDOFF.md §7). The caller passes a release object in;
// this module never reaches the wire.

import { updateCheckView, UPDATE_STATUS, RELEASE_SOURCE } from './updateCheck.js';

// Badge shown on every preview block so a viewer can never mistake it for a live,
// automatic updater. The preview SHOWS whether a newer release exists; it never
// fetches, downloads, installs, or navigates.
export const UPDATE_PREVIEW_BADGE = 'PREVIEW · MANUAL · NO AUTO-UPDATE';

// Human label for each update status. Pure; unknown statuses upper-case the raw.
export const STATUS_TEXT = Object.freeze({
  [UPDATE_STATUS.UPDATE_AVAILABLE]: 'UPDATE AVAILABLE',
  [UPDATE_STATUS.UP_TO_DATE]: 'UP TO DATE',
  [UPDATE_STATUS.UNKNOWN]: 'UNKNOWN',
});

// statusLabel(status) → display label for an update status. Pure.
export function statusLabel(status) {
  return STATUS_TEXT[status] || String(status || 'UNKNOWN').toUpperCase();
}

// updatePreviewBlock(release, { currentVersion, notesMax }) → a render-ready,
// INERT torii.quest update-check preview block:
//
//   {
//     title:          'UPDATE CHECK PREVIEW',
//     badge:          'PREVIEW · MANUAL · NO AUTO-UPDATE',
//     status:         'update-available' | 'up-to-date' | 'unknown',
//     statusLabel:    'UPDATE AVAILABLE' | 'UP TO DATE' | 'UNKNOWN',
//     currentVersion: string,            // the running runtime version
//     latestVersion:  string | null,     // the sample/latest release version
//     updateAvailable:boolean,
//     prompt:         string,            // the inert update-check prompt
//     notesPreview:   string,            // single-line capped release-notes peek
//     source:         string,            // GitHub releases PAGE url (display only)
//     lines:          [{ label, value }],// ready-to-draw rows for a DOM/HUD card
//     readOnly:       true,
//     actionable:     false,             // ALWAYS false — never fetches/installs
//   }
//
// `release` may be a raw GitHub-release-shaped object or an already-parsed
// descriptor (updateCheck handles both). Pure — never fetches, navigates, installs,
// or auto-updates. The releases-page URL is surfaced as TEXT only (no link).
export function updatePreviewBlock(release, { currentVersion, notesMax = 100 } = {}) {
  const view = updateCheckView(release, { currentVersion, notesMax });
  const label = statusLabel(view.status);
  const latest = view.latestVersion || '—';
  const notes = view.notesPreview || '—';
  const source = view.releasesPageUrl || RELEASE_SOURCE.releasesPageUrl;

  // Framing rows: running version, sampled latest release, the resolved status,
  // the GitHub releases path (concept), and a notes peek. No row is interactive.
  const lines = [
    { label: 'Version', value: view.currentVersion },
    { label: 'Latest', value: latest },
    { label: 'Status', value: label },
    { label: 'Source', value: source },
    { label: 'Notes', value: notes },
  ];

  return {
    title: 'UPDATE CHECK PREVIEW',
    badge: UPDATE_PREVIEW_BADGE,
    status: view.status,
    statusLabel: label,
    currentVersion: view.currentVersion,
    latestVersion: view.latestVersion,
    updateAvailable: view.updateAvailable,
    prompt: view.prompt,
    notesPreview: view.notesPreview,
    source,
    lines,
    readOnly: true,
    actionable: false, // display-only; fetching/installing stays a manual host step
  };
}
