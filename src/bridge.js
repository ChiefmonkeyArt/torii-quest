// bridge.js — static deck spanning the sea channel at x=20 (Stage 4, v0.2.331).
// A plain BoxGeometry deck plus two low side rails, crossing E-W at z=0 so the
// player can walk arena → bridge → NAP over the channel water. No GLB — just
// meshes. The matching walk-on collider is a Rapier cuboid built in physics.js
// (buildArenaColliders); this module only builds the visuals.
import * as THREE from 'three';
import { scene } from './scene.js';
import {
  BRIDGE_X, BRIDGE_Z, BRIDGE_DECK_Y, BRIDGE_LEN, BRIDGE_WIDTH, BRIDGE_THICK,
} from './config.js';

let _group = null;

const RAIL_H = 0.5;
const RAIL_T = 0.12;

export function buildBridge() {
  // Rebuild-safe: drop any prior bridge before re-adding (re-entering the arena
  // rebuilds the world).
  if (_group) { scene.remove(_group); _group = null; }

  const group = new THREE.Group();
  group.name = 'bridge';

  const deckMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.85, metalness: 0.04 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x7d5a3a, roughness: 0.8, metalness: 0.04 });

  // Deck slab — top surface sits at BRIDGE_DECK_Y (centre is half-thickness below).
  const deckGeo = new THREE.BoxGeometry(BRIDGE_LEN, BRIDGE_THICK, BRIDGE_WIDTH);
  const deck = new THREE.Mesh(deckGeo, deckMat);
  deck.position.set(BRIDGE_X, BRIDGE_DECK_Y - BRIDGE_THICK / 2, BRIDGE_Z);
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  // Two side rails running along the deck (z = ±half-width). Visual only.
  const railGeo = new THREE.BoxGeometry(BRIDGE_LEN, RAIL_H, RAIL_T);
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.position.set(BRIDGE_X, BRIDGE_DECK_Y + RAIL_H / 2, BRIDGE_Z + side * (BRIDGE_WIDTH / 2 - RAIL_T / 2));
    rail.castShadow = true;
    rail.receiveShadow = true;
    group.add(rail);
  }

  scene.add(group);
  _group = group;
  return group;
}
