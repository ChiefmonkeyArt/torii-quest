import * as THREE from 'three';
import { TIERS } from './qualityTier.js';

const FLASH_TYPES = {
  muzzle: { color: 0xffaa44, intensity: 3.0, distance: 8, duration: 0.08 },
  impact: { color: 0xffffaa, intensity: 2.0, distance: 6, duration: 0.12 },
  botHit: { color: 0xff4422, intensity: 2.5, distance: 10, duration: 0.15 },
  sticker: { color: 0xff7ad9, intensity: 1.6, distance: 5, duration: 0.14 }, // NAP sticker land (ADR-0132)
};

// ADR-0141: the pool size is the SAME on every quality tier. three.js bakes the
// number of visible lights into every lit material's shader, so turning a light
// on/off (or a tier change that changes the count) recompiles every lit
// material in the scene; that was the 1.5–2.5 s freeze when the first bots
// opened fire (and the slow frames then stepped the tier down, causing
// another). Lights are therefore ALWAYS visible: idle ones sit at intensity 0
// with a short range, and a tier only limits how many may be lit at once.
export const FLASH_LIGHTS = 3;
const IDLE_DISTANCE = 0.01;

export function createMuzzleFlashPool(scene, {
  size = FLASH_LIGHTS,
  getQualityTier = () => TIERS.HIGH.name,
} = {}) {
  const count = Math.max(0, Math.floor(size));
  const entries = new Array(count);

  for (let i = 0; i < count; i++) {
    const light = new THREE.PointLight(0xffffff, 0, IDLE_DISTANCE, 2);
    light.visible = true; // constant light count: never toggled (see above)
    light.castShadow = false;
    scene.add(light);
    entries[i] = { light, busy: false, elapsed: 0, duration: 0, intensity: 0 };
  }

  function _idle(entry) {
    entry.busy = false;
    entry.light.intensity = 0;
    entry.light.distance = IDLE_DISTANCE;
  }

  function trigger(type, pos, opts) {
    const preset = FLASH_TYPES[type];
    if (!preset || !pos) return false;

    const tierDef = TIERS[getQualityTier()];
    if (!tierDef || tierDef.muzzleLights === 0) return false;

    let active = 0, entry = null;
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].busy) active++;
      else if (!entry) entry = entries[i];
    }
    if (active >= tierDef.muzzleLights || !entry) return false;

    const intensity = opts?.intensity ?? preset.intensity;
    entry.busy = true;
    entry.elapsed = 0;
    entry.duration = (opts?.durationMs ?? preset.duration * 1000) / 1000;
    entry.intensity = intensity;
    entry.light.position.set(pos.x, pos.y, pos.z);
    entry.light.color.setHex(opts?.color ?? preset.color);
    entry.light.intensity = intensity;
    entry.light.distance = opts?.distance ?? preset.distance;
    return true;
  }

  function tick(dt) {
    if (!(dt > 0)) return;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry.busy) continue;
      entry.elapsed += dt;
      if (entry.elapsed >= entry.duration) { _idle(entry); continue; }
      entry.light.intensity = entry.intensity * (1 - entry.elapsed / entry.duration);
    }
  }

  /** Lights currently lit (tests / debug). */
  function activeCount() {
    let n = 0;
    for (let i = 0; i < entries.length; i++) if (entries[i].busy) n++;
    return n;
  }

  function dispose() {
    for (let i = 0; i < entries.length; i++) {
      _idle(entries[i]);
      scene.remove(entries[i].light);
    }
  }

  return { trigger, tick, activeCount, dispose };
}
