// engine/components/componentBeacon.js — first RUNTIME-mounted component (0l.2).
// Proves the runtime side of the component seam: mount(scene, opts) /
// unmount() lifecycle with a real (but safe) visual-only marker. A beacon is a
// small ring/torus + stem placed in the scene — purely decorative. No colliders,
// no raycast, no clicks, no Nostr, no network, no player state, no timers.
//
// THREE is injected via mount options (options.THREE) so the component stays
// import-safe in node (no top-level THREE import). If THREE or scene.add is
// missing, mount is a no-op — a host without a renderer still loads cleanly.
import { defineComponent, COMPONENT_CONTRACT_VERSION } from './contract.js';

export const COMPONENT_BEACON_VERSION = '0.1.0';
const DEFAULT_COLOR = 0x1ad6c4; // C_TURQ
const DEFAULT_RADIUS = 0.6;
const DEFAULT_HEIGHT = 2.0;

export function createComponentBeacon(config = {}) {
  const color = typeof config.color === 'number' ? config.color : DEFAULT_COLOR;
  const radius = Number.isFinite(config.radius) && config.radius > 0 ? config.radius : DEFAULT_RADIUS;
  const height = Number.isFinite(config.height) && config.height > 0 ? config.height : DEFAULT_HEIGHT;
  const position = Array.isArray(config.position) && config.position.length >= 3 ? config.position.slice(0, 3) : null;
  return defineComponent({
    manifest: {
      id: 'torii.componentBeacon',
      name: 'Component Beacon',
      version: COMPONENT_BEACON_VERSION,
      author: { npub: 'npub1torii0beacon0component0placeholder0author0xxxxxxxxx' },
      mountTarget: 'scene',
      contract: COMPONENT_CONTRACT_VERSION,
      kind: 'decor',
    },
    mount(scene, options = {}) {
      const THREE = options.THREE;
      if (!THREE || !scene || typeof scene.add !== 'function') return false;
      const group = new THREE.Group();
      const ringGeo = new THREE.TorusGeometry(radius, Math.max(radius * 0.12, 0.04), 8, 24);
      const stemGeo = new THREE.CylinderGeometry(Math.max(radius * 0.08, 0.03), Math.max(radius * 0.08, 0.03), height, 8);
      const mat = new THREE.MeshBasicMaterial({ color });
      const ring = new THREE.Mesh(ringGeo, mat);
      ring.rotation.x = Math.PI / 2; // lay flat
      ring.position.y = height;
      const stem = new THREE.Mesh(stemGeo, mat);
      stem.position.y = height / 2;
      group.add(ring);
      group.add(stem);
      if (position) {
        group.position.set(position[0], position[1], position[2]);
      }
      scene.add(group);
      this._group = group;
      this._mat = mat;
      this._geos = [ringGeo, stemGeo];
      return true;
    },
    unmount() {
      const g = this._group;
      if (g) {
        if (g.parent && typeof g.parent.remove === 'function') g.parent.remove(g);
        this._group = null;
      }
      if (this._mat && typeof this._mat.dispose === 'function') this._mat.dispose();
      for (const geo of this._geos || []) if (geo && typeof geo.dispose === 'function') geo.dispose();
      this._mat = null;
      this._geos = null;
    },
  });
}

export const componentBeacon = createComponentBeacon();
