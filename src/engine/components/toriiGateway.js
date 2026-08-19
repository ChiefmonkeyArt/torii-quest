// engine/components/toriiGateway.js — reference component: the Torii gateway
// (CMP-8 skeleton, v0.2.133). The canonical first droppable component, built on
// the v0.2.132 component contract (defineComponent) to prove the mount/unmount
// lifecycle end-to-end.
//
// Pure + node-safe: NO Three/Rapier/DOM/Nostr imports. This is a SKELETON — the
// lifecycle is a safe, symmetric no-op so it is contract-valid and importable in
// tests and from the SDK. The portal mesh and the Nostr node handoff are
// documented TODOs below, not implemented.
//
// Intended behaviour (NOT yet built): at mount, render a torii-gate portal at
// options.position; bind it to a destination node identified by a Nostr `npub`
// + `relay` hint; crossing the gate triggers an n2n handoff (see the world-handoff
// skeleton) to that node/zone carrying the player's identity. unmount removes the
// portal mesh and unsubscribes the handoff listeners (contract symmetry rule).

import { defineComponent, COMPONENT_CONTRACT_VERSION } from './contract.js';

// The component's own semver, independent of the game VERSION.
export const GATEWAY_VERSION = '0.1.0';

// A placeholder author npub so the skeleton satisfies the contract's provenance
// rule (author.npub required). Real gates carry the publishing author's npub.
const DEFAULT_AUTHOR_NPUB = 'npub1torii0gateway0skeleton0placeholder0author0xxxxxxxxxxxxxx';

// createToriiGateway(config) → a contract-valid component. `config` =
//   { npub, relay, target, position, model, rotation, scale }
// supplies the gate's destination + placement defaults; per-mount `options`
// override them, so one factory can serve many gates. Returns the object produced
// by defineComponent (idempotent .mount(scene, options)/.unmount()/.expand).
//
// 0l.3: the gateway is now an EXPANDING component. expandToriiGateway(config)
// returns the travel-gateway's decorative GLTF object as a plain world.object —
// the SAME shape buildWorldObjects already renders, so the gateway flows through
// the standard renderer path as if authored inline. mount/unmount stay no-ops:
// this is the DATA SHELL only — no travel, no auth, no click/raycast, no Nostr.
// The dangerous travel/auth behavior is explicitly deferred (see NON-GOALS in
// the 0l.3 PR).
export function createToriiGateway(config = {}) {
  const {
    npub = DEFAULT_AUTHOR_NPUB,
    relay = null,
    target = null,
    position = { x: 0, y: 0, z: 0 },
  } = config;

  return defineComponent({
    manifest: {
      id: 'torii.gateway',
      name: 'Torii Gateway',
      version: GATEWAY_VERSION,
      author: { npub },
      mountTarget: 'scene',
      contract: COMPONENT_CONTRACT_VERSION,
      kind: 'gateway',
      // Destination wiring the host/loader will use once the handoff is built;
      // per-mount options can override these defaults at mount time.
      gateway: { npub, relay, target, position },
    },
    // 0l.3 DATA SHELL: expand the travel-gateway's decorative GLTF object into a
    // plain world.object. `config` carries { model, position, rotation, scale };
    // the exact values are baked (Y from sampleNapHeight at authoring time) so
    // there is NO runtime NAP-height sampling here. Returns [] if the model is
    // missing/malformed (the resolver then omits the object, no error).
    expand: () => expandToriiGateway(config),
    // SKELETON no-op mount: attaches nothing today. The data shell handles the
    // visual via expand; runtime travel/auth is a documented TODO, NOT built.
    // TODO(CMP-8): build the torii-gate portal mesh + subscribe the n2n handoff
    // (npub/relay → world-handoff) here — once travel behavior is owned.
    mount(_scene, _options = {}) { /* skeleton: no-op */ },
    // SKELETON no-op unmount — nothing was attached, so the contract symmetry
    // rule (unmount fully reverses mount) holds trivially.
    // TODO(CMP-8): remove the portal mesh + unsubscribe the handoff listeners.
    unmount() { /* skeleton: no-op */ },
  });
}

// expandToriiGateway(config) → the travel-gateway's decorative GLTF object as a
// plain world.object (shape-equivalent to the 0k.4 baked inline object). Pure +
// node-safe. `config` = { model, position, rotation, scale } (all baked). Returns
// [] when the model is missing/malformed so the resolver omits it cleanly.
export function expandToriiGateway(config = {}) {
  const model = typeof config.model === 'string' ? config.model : null;
  if (!model) return [];
  const position = Array.isArray(config.position) && config.position.length >= 3
    ? [Number(config.position[0]), Number(config.position[1]), Number(config.position[2])]
    : null;
  if (!position || position.some((n) => !Number.isFinite(n))) return [];
  const rotation = Array.isArray(config.rotation) && config.rotation.length >= 3
    ? [Number(config.rotation[0]), Number(config.rotation[1]), Number(config.rotation[2])]
    : [0, 0, 0];
  const scale = Number.isFinite(Number(config.scale)) ? Number(config.scale) : 1;
  return [{ type: 'gltf', model, position, rotation, scale }];
}

// A ready, contract-valid default instance for SDK discovery / demos.
export const toriiGateway = createToriiGateway();
