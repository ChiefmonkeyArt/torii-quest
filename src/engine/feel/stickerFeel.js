// src/engine/feel/stickerFeel.js — NAP sticker feel pass (ADR-0132).
//
// The Game Zone feel pattern (ADR-0131), applied with a playful curve to the
// peaceful NAP zone. On the click's frame the player gets a pink marker when
// the sticker is heading for a character. When it lands they get a bubbly pop
// (mixed by distance and bearing), a pink sparkle, and on a character a
// "STUCK!" pop plus a giggle bounce from the NPC. There are no damage
// numbers, flinches or kills here.
//
// Pure and node-safe: the curves are plain maths, and the orchestrator only
// calls injected hooks (HUD, audio, flash, NPC bounce). stickerNpc.js reports
// fire and land events; arenaRuntime wires the hooks.

import { shotMix, createFeelMeter } from '../../gamezone/client/feel.js';

// ── giggle bounce (NPC reaction) ─────────────────────────────────────────────
export const BOUNCE_MS = 380;
export const BOUNCE_SQUASH = 0.08; // peak fractional squash / stretch
export const BOUNCE_HOP = 0.09;    // m — peak hop height
const B1 = 70, B2 = 260;           // phase ends: squash | hop | settle

/**
 * Squash-and-stretch bounce at elapsed ms: a quick squash, a small hop
 * (stretched in the air), then a softer landing squash. Every phase starts and
 * ends at rest, so the curve is continuous. Volume is preserved:
 * sxz = 1/√sy. Writes {sy, sxz, hop} into `out`.
 */
export function bounceEnvelope(ms, out = { sy: 1, sxz: 1, hop: 0 }) {
  let sy = 1, hop = 0;
  if (ms >= 0 && ms < BOUNCE_MS) {
    if (ms < B1) {
      sy = 1 - BOUNCE_SQUASH * Math.sin(Math.PI * (ms / B1));
    } else if (ms < B2) {
      const s = Math.sin(Math.PI * ((ms - B1) / (B2 - B1)));
      hop = BOUNCE_HOP * s;
      sy = 1 + BOUNCE_SQUASH * 0.7 * s;
    } else {
      sy = 1 - BOUNCE_SQUASH * 0.5 * Math.sin(Math.PI * ((ms - B2) / (BOUNCE_MS - B2)));
    }
  }
  out.sy = sy; out.sxz = 1 / Math.sqrt(sy); out.hop = hop;
  return out;
}

/**
 * Deterministic pop pitch in 0.92..1.08 so a burst of stickers doesn't sound
 * mechanical. Golden-ratio (Weyl) steps: consecutive pops always differ by at
 * least ~6 % of the range, and the sequence never settles into a loop.
 */
export function popPitch(n) {
  const f = (n * 0.6180339887) % 1;
  return 0.92 + 0.16 * (f < 0 ? f + 1 : f);
}

/** Which sticker targets are characters (they get the marker, STUCK! and a boing). */
export function isCharacterTarget(t) { return t === 'npc' || t === 'peer' || t === 'bot'; }

// ── orchestrator ─────────────────────────────────────────────────────────────
/**
 * deps (all optional):
 *  hud { showHitMarker(kind), popCombatText(text, kind) }
 *  sfx { stick(level, pan, character, pitch) }
 *  flash(kind, point)          pink light at the landing point
 *  bounceNpc()                 NPC giggle bounce
 *  getListener() → {x, z, yaw} player position/heading for the pop mix
 *  inputAt() → ms              click timestamp (performance.now clock)
 *  now() → ms
 */
export function createStickerFeel(d = {}) {
  const now = d.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const meter = createFeelMeter(32);
  const c = { fired: 0, misses: 0, aimedAtCharacter: 0, aimedAtSurface: 0, landed: 0, stuck: 0, bounces: 0 };
  const mix = { gain: 1, pan: 0 };
  let pops = 0;

  return {
    /** Synchronous in the click's input event. `info` null = the ray hit nothing. */
    onFire(info) {
      c.fired++;
      meter.shotAt(d.inputAt ? d.inputAt() : now());
      if (!info) { c.misses++; return; }
      if (isCharacterTarget(info.target)) {
        c.aimedAtCharacter++;
        meter.marker();
        if (d.hud && d.hud.showHitMarker) d.hud.showHitMarker('sticker');
      } else {
        c.aimedAtSurface++;
      }
    },
    /** The sticker reached its target (end of its 0.22 s flight). */
    onLand(info) {
      if (!info) return;
      c.landed++;
      const ch = isCharacterTarget(info.target);
      let gain = 1, pan = 0;
      const L = d.getListener ? d.getListener() : null;
      if (L && info.point) {
        shotMix(L.x, L.z, L.yaw, info.point.x, info.point.z, mix);
        gain = mix.gain; pan = mix.pan;
      }
      if (d.sfx && d.sfx.stick) d.sfx.stick(gain, pan, ch, popPitch(pops++));
      if (d.flash && info.point) d.flash('sticker', info.point);
      if (ch) {
        c.stuck++;
        if (d.hud && d.hud.popCombatText) d.hud.popCombatText('STUCK!', 'sticker');
        if (info.target === 'npc' && d.bounceNpc) { d.bounceNpc(); c.bounces++; }
      }
    },
    /** Call once per rendered frame (closes the click→frame latency sample). */
    frame(t) { meter.frameAt(t === undefined ? now() : t); },
    stats() {
      const m = meter.stats();
      return { ...c, samples: m.samples, clickToFrameMs: m.clickToFrameMs };
    },
    reset() { meter.reset(); for (const k of Object.keys(c)) c[k] = 0; pops = 0; },
  };
}
