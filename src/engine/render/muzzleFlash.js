import * as THREE from 'three';
import { TIERS } from './qualityTier.js';

const FLASH_TYPES = {
  muzzle: { color: 0xffaa44, intensity: 3.0, distance: 8, duration: 0.08 },
  impact: { color: 0xffffaa, intensity: 2.0, distance: 6, duration: 0.12 },
  botHit: { color: 0xff4422, intensity: 2.5, distance: 10, duration: 0.15 },
};

export function createMuzzleFlashPool(scene, {
  size = 8,
  getQualityTier = () => TIERS.HIGH.name,
} = {}) {
  const count = Math.max(0, Math.floor(size));
  const entries = new Array(count);

  for (let i = 0; i < count; i++) {
    const light = new THREE.PointLight(0xffffff, 0, 0, 2);
    light.visible = false;
    light.castShadow = false;
    scene.add(light);
    entries[i] = { light, elapsed: 0, duration: 0, intensity: 0 };
  }

  function trigger(type, pos, opts) {
    const preset = FLASH_TYPES[type];
    if (!preset || !pos || getQualityTier() === TIERS.LOW.name) return false;

    let entry = null;
    for (let i = 0; i < entries.length; i++) {
      if (!entries[i].light.visible) {
        entry = entries[i];
        break;
      }
    }
    if (!entry) return false;

    const intensity = opts?.intensity ?? preset.intensity;
    entry.elapsed = 0;
    entry.duration = (opts?.durationMs ?? preset.duration * 1000) / 1000;
    entry.intensity = intensity;
    entry.light.position.set(pos.x, pos.y, pos.z);
    entry.light.color.setHex(opts?.color ?? preset.color);
    entry.light.intensity = intensity;
    entry.light.distance = opts?.distance ?? preset.distance;
    entry.light.visible = true;
    return true;
  }

  function tick(dt) {
    if (!(dt > 0)) return;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry.light.visible) continue;
      entry.elapsed += dt;
      if (entry.elapsed >= entry.duration) {
        entry.light.intensity = 0;
        entry.light.visible = false;
        continue;
      }
      entry.light.intensity = entry.intensity * (1 - entry.elapsed / entry.duration);
    }
  }

  function dispose() {
    for (let i = 0; i < entries.length; i++) {
      const light = entries[i].light;
      light.visible = false;
      light.intensity = 0;
      scene.remove(light);
    }
  }

  return { trigger, tick, dispose };
}
