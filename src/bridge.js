// bridge.js — static decks spanning the sea channels (v0.2.511 — tomoe layout).
// Two bridges: Bridge 1 (NAP↔Arena BL, with torii gate) and Bridge 2 (Arena BL↔Arena BR, no gate).
// Each is a plain BoxGeometry deck plus two low side rails. The matching walk-on
// colliders are Rapier cuboids built in physics.js; this module only builds visuals.
import * as THREE from 'three';
import { scene } from './scene.js';
import {
  BRIDGE_X, BRIDGE_Z, BRIDGE_DECK_Y, BRIDGE_LEN, BRIDGE_WIDTH, BRIDGE_THICK,
  BRIDGE2_X, BRIDGE2_Z, BRIDGE2_LEN, BRIDGE2_WIDTH, BRIDGE2_THICK,
  BRIDGE_YAW,
} from './config.js';

const RAIL_H = 0.5;
const RAIL_T = 0.12;

const _groups = [];

function _buildOne(x, z, deckY, len, width, thick, name) {
  const group = new THREE.Group();
  group.name = name;

  const deckMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.85, metalness: 0.04 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x7d5a3a, roughness: 0.8, metalness: 0.04 });

  // Deck slab — top surface sits at deckY (centre is half-thickness below).
  const deckGeo = new THREE.BoxGeometry(len, thick, width);
  const deck = new THREE.Mesh(deckGeo, deckMat);
  deck.position.set(x, deckY - thick / 2, z);
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  // Two side rails running along the deck (z = ±half-width). Visual only.
  const railGeo = new THREE.BoxGeometry(len, RAIL_H, RAIL_T);
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.position.set(x, deckY + RAIL_H / 2, z + side * (width / 2 - RAIL_T / 2));
    rail.castShadow = true;
    rail.receiveShadow = true;
    group.add(rail);
  }

  scene.add(group);
  _groups.push(group);
  return group;
}

export function buildBridge() {
  // Rebuild-safe: drop any prior bridges before re-adding.
  while (_groups.length) { scene.remove(_groups.pop()); }

  // Bridge 1: NAP ↔ Arena BL (with torii gate) — rotated 45°
  const b1 = _buildOne(BRIDGE_X, BRIDGE_Z, BRIDGE_DECK_Y, BRIDGE_LEN, BRIDGE_WIDTH, BRIDGE_THICK, 'bridge-nap-bl');
  b1.rotation.y = BRIDGE_YAW;

  // Bridge 2: Arena BL ↔ Arena BR (no gate)
  _buildOne(BRIDGE2_X, BRIDGE2_Z, BRIDGE_DECK_Y, BRIDGE2_LEN, BRIDGE2_WIDTH, BRIDGE2_THICK, 'bridge-bl-br');
}
