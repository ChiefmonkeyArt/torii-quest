// engine/components/contract.js — pure component contract (CMP-2, v0.2.132).
//
// The machine-checkable slice of the Torii component economy (full spec in
// COMPONENTS.md). A "component" is a self-contained, droppable world module that
// exposes mount(scene, options) / unmount() and ships a JSON-serialisable
// manifest describing identity, provenance, and (optionally) price.
//
// This module is deliberately PURE: no THREE, no Rapier, no DOM, no scene. It
// only validates shapes and wraps a definition with idempotent lifecycle
// bookkeeping, so it is node-testable and safe to re-export from the SDK
// entrypoint. Signature/hash/capability ENFORCEMENT (verifying the Nostr event
// signature, the bundle hash, declared capabilities) is host-side and tracked as
// later CMP work — see COMPONENTS.md §7.

// Contract version this module implements. Manifests may declare the contract
// version they target via manifest.contract; hosts compare against this.
export const COMPONENT_CONTRACT_VERSION = '0.1.0';

// Manifest fields a component MUST declare (see COMPONENTS.md §2).
export const REQUIRED_MANIFEST_FIELDS = Object.freeze([
  'id', 'name', 'version', 'author', 'mountTarget',
]);

// Mount targets a host knows how to scope (COMPONENTS.md §5).
export const MOUNT_TARGETS = Object.freeze(['scene', 'hud', 'panel', 'zone']);

function _isBlank(v) { return v == null || v === ''; }

// validateManifest(manifest) → { valid, errors }. Pure: never throws, returns a
// list of human-readable problems. Empty errors ⇒ valid. Mirrors the required
// fields + provenance + pricing rules in COMPONENTS.md §2.
export function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['manifest must be an object'] };
  }
  for (const f of REQUIRED_MANIFEST_FIELDS) {
    if (_isBlank(manifest[f])) errors.push(`missing required field: ${f}`);
  }
  // Author provenance — an npub is required for attribution (COMPONENTS.md §3).
  if (manifest.author != null) {
    if (typeof manifest.author !== 'object') {
      errors.push('author must be an object with an npub');
    } else if (_isBlank(manifest.author.npub)) {
      errors.push('author.npub is required for provenance');
    }
  }
  // Mount target must be one the host can scope.
  if (!_isBlank(manifest.mountTarget) && !MOUNT_TARGETS.includes(manifest.mountTarget)) {
    errors.push(`unknown mountTarget: ${manifest.mountTarget}`);
  }
  // Pricing, when present, must be free or a positive sats amount (§2).
  if (manifest.pricing != null) {
    const { free, sats } = manifest.pricing;
    if (!free && !(Number.isFinite(sats) && sats > 0)) {
      errors.push('pricing must be { free: true } or carry a positive sats amount');
    }
  }
  return { valid: errors.length === 0, errors };
}

// isComponent(obj) → does this object satisfy the runtime lifecycle contract?
// (mount + unmount functions). Shape check only — does not run anything.
export function isComponent(obj) {
  return !!obj && typeof obj.mount === 'function' && typeof obj.unmount === 'function';
}

// isExpandingComponent(obj) → does this component ALSO expose a pure data-expansion
// path? An expanding component's expand(config) returns a list of plain
// world.objects (the same validated shape buildWorldObjects/buildWorldObjectColliders
// consume). This is the seam that lets a droppable component contribute STATIC
// scenery data (crates, props, decor) without a runtime mount — the host resolves
// the component into world.objects at manifest-load time, then the existing
// renderer/collider path builds them as if they were authored inline. Shape check
// only; does not run expand.
export function isExpandingComponent(obj) {
  return isComponent(obj) && typeof obj.expand === 'function';
}

// defineComponent(def) → wrap a plain definition into a validated component with
// idempotent lifecycle bookkeeping. `def.mount(scene, options)` and
// `def.unmount()` are required; `def.manifest` is validated. Throws on an invalid
// contract so a bad component fails fast at registration, never mid-game.
//
// The returned component:
//   - .manifest        the (validated) manifest
//   - .mounted         boolean, current lifecycle state
//   - .mount(scene, options={}) → true if it mounted now, false if already mounted
//   - .unmount()                → true if it unmounted now, false if already down
export function defineComponent(def) {
  if (!def || typeof def.mount !== 'function' || typeof def.unmount !== 'function') {
    throw new Error('component requires mount(scene, options) and unmount() functions');
  }
  const manifest = def.manifest || {};
  const { valid, errors } = validateManifest(manifest);
  if (!valid) throw new Error('invalid component manifest: ' + errors.join('; '));

  let _mounted = false;
  return {
    manifest,
    get mounted() { return _mounted; },
    mount(scene, options = {}) {
      if (_mounted) return false;      // idempotent — already mounted
      def.mount(scene, options);
      _mounted = true;
      return true;
    },
    unmount() {
      if (!_mounted) return false;     // idempotent — already torn down
      def.unmount();
      _mounted = false;
      return true;
    },
    // Pure data-expansion path (optional). When a component declares
    // def.expand(config), the host resolver calls it at manifest-load time to
    // contribute static world.objects (scenery/props). Returns [] for a
    // non-expanding component so callers can always treat the result as a list.
    expand(config = {}) {
      return typeof def.expand === 'function' ? def.expand(config) : [];
    },
  };
}
