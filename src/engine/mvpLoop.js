// engine/mvpLoop.js — pure, node-safe framing for the four MVP/proof surfaces
// (LEAN-2..5, v0.2.143). Names the single proof-of-concept loop they form —
// Travel → Market → Score → Update — and produces a render-ready header block a
// title-screen card can draw directly so the four proof surfaces read as one MVP
// loop instead of four unrelated panels. As of v0.2.403-alpha the MARKET surface
// lives in the in-world NAP zone (the title-screen product card was removed); the
// remaining surfaces are framed here regardless of where each is presented.
//
// Pure + node-safe: NO Three/Rapier/DOM, NO network, NO navigation, NO I/O. This
// is content/labelling ONLY — it describes the loop; it never performs any of the
// four steps. The surfaces it frames are all inert previews
// (gatewayPreview/productPreview/leaderboardPreview/updatePreview): the block is
// `actionable:false` / `readOnly:true` by construction.

import { VERSION } from '../config.js';

// Badge shown on the loop header so the grouping can never be mistaken for a live,
// automatic pipeline. The loop is a PREVIEW of read-only, MANUAL freedom-tech steps.
export const MVP_LOOP_BADGE = 'PREVIEW · READ ONLY · MANUAL';

// The four ordered steps of the proof-of-concept loop. `card` ties each step to
// the inert preview card that demonstrates it; `lean` is the PoC slice id.
export const MVP_LOOP_STEPS = Object.freeze([
  Object.freeze({ n: 1, step: 'TRAVEL', card: 'Gateway',      lean: 'LEAN-2' }),
  Object.freeze({ n: 2, step: 'MARKET', card: 'Product',      lean: 'LEAN-3' }),
  Object.freeze({ n: 3, step: 'SCORE',  card: 'Leaderboard',  lean: 'LEAN-4' }),
  Object.freeze({ n: 4, step: 'UPDATE', card: 'Update check', lean: 'LEAN-5' }),
]);

// Title-cased flow string, e.g. "Travel → Market → Score → Update". Pure.
export const MVP_LOOP_FLOW = MVP_LOOP_STEPS
  .map((s) => s.step.charAt(0) + s.step.slice(1).toLowerCase())
  .join(' → ');

// mvpLoopSummary({ currentVersion }) → a render-ready, INERT header block framing
// the four preview cards as one loop:
//
//   {
//     title:     'TORII QUEST · MVP LOOP',
//     badge:     'PREVIEW · READ ONLY · MANUAL',
//     flow:      'Travel → Market → Score → Update',
//     note:      string,                  // explicit "these are inert previews" line
//     version:   string,                  // the running runtime version
//     steps:     [{ n, step, card, lean, label }],
//     lines:     [{ label, value }],      // ready-to-draw rows ("1 · TRAVEL" → card)
//     readOnly:  true,
//     actionable:false,                   // ALWAYS false — content/labelling only
//   }
//
// Pure — never navigates, fetches, signs, publishes, or updates.
export function mvpLoopSummary({ currentVersion = VERSION } = {}) {
  const steps = MVP_LOOP_STEPS.map((s) => ({ ...s, label: `${s.n} · ${s.step}` }));
  const lines = steps.map((s) => ({ label: s.label, value: s.card }));
  return {
    title: 'TORII QUEST · MVP LOOP',
    badge: MVP_LOOP_BADGE,
    flow: MVP_LOOP_FLOW,
    note: 'All four MVP surfaces are inert previews (Market lives in the NAP zone) — no live external actions.',
    version: currentVersion,
    steps,
    lines,
    readOnly: true,
    actionable: false, // content/labelling only; the steps themselves stay manual
  };
}
