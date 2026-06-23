# Torii Quest — Component Manifest Spec (CMP-1)

> Draft spec for the Torii Quest **component economy**: how a self-contained,
> droppable world module is described, identified, distributed, priced, and
> verified. Pre-1.0 alpha — the shapes here are a target the SDK grows into, not a
> frozen wire format. The machine-checkable slice lives in
> `src/engine/components/contract.js` (CMP-2) and is surfaced via `src/sdk/index.js`
> as the `component` namespace.

See `strategy.md` (Reusable Components Library and Community Marketplace) for the
vision and `todo.md` (Later — Component Economy) for the CMP-1..CMP-16 task list.

---

## 1. What a component is

A **component** is a self-contained module that can be dropped into a running
Torii world and removed cleanly, with no global side effects left behind. At
runtime it is an object exposing exactly two lifecycle methods:

```js
component.mount(scene, options)   // attach to the world; idempotent
component.unmount()               // detach + dispose everything it created
```

- `mount(scene, options)` receives the host scene (or a scoped mount target) and
  an options bag (author-tunable settings, see §4 `config`). It must create all
  of its own objects and keep handles to them.
- `unmount()` must remove and dispose **everything** `mount` created (meshes,
  listeners, timers, sockets, relays) so the component leaves no trace. A
  component that cannot fully tear down is invalid.
- Both are **idempotent**: a second `mount()` while mounted is a no-op, and
  `unmount()` while unmounted is a no-op. The reference wrapper
  (`defineComponent`) enforces this with a `mounted` flag.

Reference components targeted for the library: n2n node jumper / gateway, live
chat (NIP-28/29), video chat (WebRTC), art frame (Plebeian gallery), auction
panel (kind:30402 / kind:16), product display + browser (NIP-15).

### Reference component: Torii gateway (CMP-8, v0.2.133)

The first concrete reference component lives at
`src/engine/components/toriiGateway.js` and is surfaced via the SDK
`toriiGateway` namespace (experimental tier). It is built on the `defineComponent`
contract (CMP-2) so it is contract-valid, idempotent, and node-testable
(`tests/torii-gateway.test.js`).

```js
import { createToriiGateway, toriiGateway, GATEWAY_VERSION } from
  '../engine/components/toriiGateway.js';            // or SDK.toriiGateway.*

const gate = createToriiGateway({ npub, relay, target, position });
gate.mount(scene, { position });                     // idempotent
gate.unmount();                                       // symmetric teardown
```

- **Manifest:** `id: 'torii.gateway'`, `kind: 'gateway'`, `mountTarget: 'scene'`,
  provenance `author.npub`, and a `gateway: { npub, relay, target, position }`
  destination block. `createToriiGateway(config)` threads the supplied
  `npub`/`relay`/`target`/`position` into that block (one factory serves many
  gates); per-mount `options` override placement at mount time.
- **Lifecycle (skeleton):** mount/unmount are symmetric no-ops today — pure and
  node-safe (NO Three/Rapier/DOM/Nostr imports). The portal mesh and the n2n
  Nostr handoff (cross the gate → hand the player's identity off to the
  destination node identified by `npub`/`relay`) are documented TODOs in the
  module header, not yet built. The skeleton exists to prove the
  mount/unmount lifecycle end-to-end and give the SDK a discoverable first
  droppable component.

> **v0.2.133 reconciliation note.** This component and this spec are built on the
> **published v0.2.132 contract** (`defineComponent` / `validateManifest` →
> `{valid,errors}` / `isComponent`). An earlier, divergent v0.2.133 draft of the
> contract + a parallel COMPONENTS/contract approach was intentionally superseded
> in favour of the v0.2.132 published API so no v0.2.132 work is dropped.

---

## 2. The manifest

Every component ships a manifest — a plain JSON-serialisable object describing
identity, provenance, capabilities, and (optionally) price. Required fields are
validated by `validateManifest()`; the rest are optional but recommended.

```jsonc
{
  // ---- Identity (required) ----
  "id": "torii.chat.nip28",          // globally unique, reverse-dotted
  "name": "Live Chat",               // human label
  "version": "1.0.0",                // semver of THIS component build
  "author": {                        // provenance (required; npub required)
    "npub": "npub1...",              // Nostr public key of the author
    "name": "satoshi"                // optional display name
  },
  "mountTarget": "scene",            // where it attaches (see §5)

  // ---- Provenance / integrity (recommended) ----
  "bundle": {
    "url": "https://.../live-chat-1.0.0.js",
    "hash": "sha256-...",            // hash of the bundle bytes; verified on load
    "size": 18244                    // bytes (advisory)
  },
  "contract": "0.1.0",               // component-contract version it targets

  // ---- Capabilities / permissions (recommended) ----
  "capabilities": ["scene", "nostr", "network", "input"],
  "dependencies": [                  // other components/SDK surfaces it needs
    { "id": "torii.sdk", "version": ">=0.2.132" }
  ],
  "assets": [                        // external assets the component loads
    { "type": "model", "url": "https://.../frame.glb", "hash": "sha256-..." }
  ],

  // ---- Config (optional) ----
  "config": {                        // author-declared tunables → mount options
    "relay": { "type": "string", "default": "wss://relay.example" },
    "maxMessages": { "type": "number", "default": 100 }
  },

  // ---- Economy (optional) ----
  "pricing": {                       // omit, or { "free": true }, or sats price
    "free": false,
    "sats": 2100,                    // one-time unlock price in sats
    "methods": ["lightning", "cashu", "nutzap"]
  },
  "zapSplit": [                      // NIP-57/61 revenue share; weights sum free
    { "npub": "npub1author...", "weight": 90 },
    { "npub": "npub1curator...", "weight": 10 }
  ],

  // ---- Marketplace listing (optional) ----
  "listing": {
    "summary": "Drop-in Nostr chat panel.",
    "tags": ["chat", "nostr", "social"],
    "preview": "https://.../preview.png"
  }
}
```

### Required fields

`id`, `name`, `version`, `author` (with `author.npub`), `mountTarget`. A manifest
missing any of these is rejected by `validateManifest()`.

### Pricing rules

`pricing` is optional. When present it must be **either** `{ "free": true }`
**or** carry a positive `sats` amount. `{ "free": false }` with no positive
`sats` is invalid (a paid component must name a price).

---

## 3. Identity, provenance & versioning

- **Author identity is a Nostr npub.** Every component is attributable to an
  npub; there is no anonymous publishing in the economy. `author.npub` is
  required.
- **Bundle integrity by hash.** The manifest references a versioned bundle by URL
  **and** content hash (`bundle.hash`). Loaders MUST verify the downloaded bytes
  against the hash before executing; a mismatch aborts the load.
- **Versioning & forks.** `version` is the component build's semver. A fork keeps
  the lineage discoverable: it publishes under the forker's npub, may reference
  the upstream `id`/npub it derives from, and is verified by its own bundle hash.
  Attribution travels with the npub; integrity travels with the hash.

---

## 4. Config → mount options

`manifest.config` declares author-tunable settings (name → `{ type, default }`).
The host resolves user/listing overrides against these defaults and passes the
resolved bag to `mount(scene, options)`. Components must treat `options` as
untrusted input and fall back to their declared defaults for anything missing or
malformed.

---

## 5. Mount targets

`mountTarget` names where the component attaches so the host can scope it:

| value     | meaning                                                            |
|-----------|-------------------------------------------------------------------|
| `scene`   | the main world scene (default)                                     |
| `hud`     | a 2D HUD/overlay layer                                             |
| `panel`   | a bounded in-world panel/surface (e.g. a wall frame)              |
| `zone`    | a named open-world zone (e.g. the NAP zone past the torii gate)   |

Unknown targets are rejected by the host until a target handler exists for them.

---

## 6. Distribution & discovery (Nostr)

Components are distributed as **signed Nostr events**. A listing event carries
the manifest (or a reference to it) plus the author signature; clients discover
components by querying relays for the listing kind and filtering by tag/author.

- Listing/manifest events use a parameterised-replaceable kind (NIP-78
  `kind:30078` application data, or a dedicated Torii kind) so a given `id`+npub
  has one current version per relay, with history preserved by event id.
- Auctions/sales reference the standard marketplace kinds (`kind:30402` /
  `kind:16`) and product listings reference NIP-15 where applicable.
- Payment + revenue share use Lightning / Cashu / Nutzap, with `zapSplit`
  expressed via NIP-57/61 zap splits.

(The concrete relay/event wiring is later CMP work; this section fixes the
intent so the manifest carries the fields those events will need.)

---

## 7. Security & verification rules

A host MUST, before mounting a third-party component:

1. **Verify the signature** of the listing event against `author.npub`.
2. **Verify the bundle hash** (`bundle.hash`) against the downloaded bytes;
   abort on mismatch.
3. **Verify asset hashes** (`assets[].hash`) for any external asset loaded.
4. **Honour declared capabilities.** A component may only use the capabilities it
   declared (`capabilities`); the host gates `network`/`nostr`/`input`/etc.
   accordingly and denies anything undeclared.
5. **Enforce clean teardown.** `unmount()` must release everything; the host may
   refuse to keep a component that fails to tear down.
6. **Never relax core game constraints.** A component cannot enable `godMode`,
   add disallowed timers, or violate the firing/pause invariants in
   `HANDOFF.md` §2. Components run alongside the game, not above its rules.

Validation today is intentionally a thin, machine-checkable slice
(`validateManifest` / `isComponent` / `defineComponent` in
`src/engine/components/contract.js`); signature, hash, and capability
enforcement are tracked as later CMP tasks.
