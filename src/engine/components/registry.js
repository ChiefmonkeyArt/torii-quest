// engine/components/registry.js — minimal component loader/registry (CMP-7
// skeleton, v0.2.135). The host-side index of KNOWN, BUILT-IN components: it maps
// a component id (and kind) to a factory and hands back a fresh, contract-valid
// component instance on load, validating the manifest/contract first.
//
// Pure + node-safe: NO Three/Rapier/DOM/Nostr, NO network. SECURITY by design —
// this loader ONLY serves factories that were imported into the build at compile
// time. It does NOT eval, does NOT dynamic-import, and does NOT fetch code from a
// URL/relay. "Loading" here means "look up a vetted local factory and build an
// instance", never "execute remote code". Verifying a remote bundle's signature/
// hash before it could ever be registered is later, host-side CMP work
// (COMPONENTS.md §7) — this skeleton deliberately has no remote path at all.
//
// A factory is a `(config) => component` function (e.g. createToriiGateway). The
// registry probes it once at registration to learn its id/kind and to fail fast
// on a bad component, then calls it per load so each load gets its own mount
// state.

import { isComponent, validateManifest, COMPONENT_CONTRACT_VERSION } from './contract.js';
import { createToriiGateway } from './toriiGateway.js';
import { createProductDisplay } from './productDisplay.js';

// createRegistry() → an empty registry. `register(factory)` adds a built-in,
// `load(id, config)` returns a fresh instance + a validation result.
export function createRegistry() {
  // id → { id, kind, factory }
  const entries = new Map();

  // register(factory) → the registered id. Probes the factory once: the probe
  // must be a contract component with a valid manifest, or registration throws
  // (a bad component fails at registration, never mid-game). Duplicate ids throw.
  function register(factory) {
    if (typeof factory !== 'function') {
      throw new Error('component factory must be a (config) => component function');
    }
    const probe = factory();
    if (!isComponent(probe)) {
      throw new Error('factory did not produce a component (needs mount/unmount)');
    }
    const manifest = probe.manifest || {};
    const { valid, errors } = validateManifest(manifest);
    if (!valid) throw new Error('factory manifest invalid: ' + errors.join('; '));
    const id = manifest.id;
    if (entries.has(id)) throw new Error('duplicate component id: ' + id);
    entries.set(id, { id, kind: manifest.kind || null, factory });
    return id;
  }

  function has(id) { return entries.has(id); }

  // ids() / kinds() — discovery. byKind(kind) → the ids registered for a kind.
  function ids() { return [...entries.keys()]; }
  function kinds() {
    return [...new Set([...entries.values()].map((e) => e.kind).filter((k) => k != null))];
  }
  function byKind(kind) {
    return [...entries.values()].filter((e) => e.kind === kind).map((e) => e.id);
  }

  // load(id, config) → { ok, component, manifest, errors }. Builds a FRESH
  // instance from the registered factory and re-validates its manifest +
  // contract version before returning. Never throws — an unknown id or an
  // invalid build degrades to { ok:false, component:null, errors:[…] }.
  function load(id, config = {}) {
    const entry = entries.get(id);
    if (!entry) return { ok: false, component: null, manifest: null, errors: ['unknown component id: ' + id] };

    let component;
    try {
      component = entry.factory(config);
    } catch (e) {
      return { ok: false, component: null, manifest: null, errors: ['factory threw: ' + (e?.message || String(e))] };
    }
    if (!isComponent(component)) {
      return { ok: false, component: null, manifest: null, errors: ['factory did not produce a component'] };
    }
    const manifest = component.manifest || {};
    const errors = validateManifest(manifest).errors.slice();
    // Contract-version compatibility: a manifest may declare the contract it
    // targets; reject a mismatch so an incompatible component never mounts.
    if (manifest.contract != null && manifest.contract !== COMPONENT_CONTRACT_VERSION) {
      errors.push(`incompatible contract version: ${manifest.contract} (host ${COMPONENT_CONTRACT_VERSION})`);
    }
    return { ok: errors.length === 0, component: errors.length === 0 ? component : null, manifest, errors };
  }

  return {
    register,
    has,
    ids,
    kinds,
    byKind,
    load,
    get size() { return entries.size; },
  };
}

// The default built-in registry: every component shipped in this build, ready to
// load by id. Add new built-ins here as they land (the loader serves ONLY what
// is registered — see the security note at the top of the file).
export function createBuiltinRegistry() {
  const reg = createRegistry();
  reg.register(createToriiGateway);
  reg.register(createProductDisplay);
  return reg;
}

// A ready default instance for SDK discovery / demos.
export const builtinRegistry = createBuiltinRegistry();
