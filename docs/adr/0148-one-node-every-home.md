# ADR-0148: One Node, Every Home (VPS, Laptop, Start9, Umbrel)

- **Status:** Proposed (2026-10-24). Awaiting owner approval of the direction and the open decisions below.
- **Date:** 2026-10-24
- **Deciders:** chiefmonkey
- **Related:**
  - ADR-0147 (sovereign metaverse architecture), ADR-0117 (world-as-data travel), ADR-0143 (Gate is the product), ADR-0101 (auto-deploy on tag);
  - `Dockerfile`, `docker-compose.yml`, `src/engine/world/worldReference.js`;
  - torii-suite `installers/install-quest.sh`.

## Context

The owner's goal (2026-10-24) is "the most logical, secure, safe, free, self-sovereign, self-federated, decentralised metaverse possible using VPSs, laptops and Start9 / Umbrel".

Today a Torii node runs in one place: a VPS installed by torii-suite (nginx + systemd + `/apps/quest`). The repository already ships a self-hosting stack in one multi-stage `Dockerfile` and `docker-compose.yml`:

- `web`: Caddy serving the static game, reverse-proxying `/mp` and `/relay`;
- `arena-ws`: the multiplayer server;
- `strfry`: the node's own Nostr relay.

The two home-server platforms want exactly this shape:

- **Umbrel** installs an app from a community app store repository. Each app is an `umbrel-app.yml` manifest plus a `docker-compose.yml`, fronted by Umbrel's `app_proxy` (which adds Umbrel login unless disabled) and persisting data under `${APP_DATA_DIR}` ([Umbrel app framework](https://deepwiki.com/getumbrel/umbrel-apps/2-application-framework), [community store layout](https://github.com/lucasilverentand/umbrel-apps)). Umbrel exposes apps on the LAN and as Tor hidden services (`$APP_HIDDEN_SERVICE`, [app template](https://github.com/sorokinvld/portal-apps)).
- **StartOS 0.4** installs a signed `.s9pk`: OCI images plus a TypeScript manifest built with `start-cli` / `@start9labs/start-sdk`. Services run in isolated LXC containers, and packages can be published to a self-hosted registry or the Start9 Community Registry ([Quick Start](https://docs.start9.com/packaging/0.4.0.x/quick-start.html), [Publishing](https://docs.start9.com/packaging/0.4.0.x/publishing.html), [start-technologies](https://github.com/Start9Labs/start-technologies/)).

Two facts shape the design:

1. **Home devices are not publicly reachable** by default. They sit behind NAT and reach the outside through LAN names, Tor onions, or a tunnel (StartTunnel, Tailscale, a friend's VPS).
2. **Torii travel already doesn't depend on hosts.** A world is found by the owner's npub: a signed kind-30078 world reference names a **manifest hash**, relays and a Blossom server (`worldReference.js`). The manifest is verified by hash, so **any** server holding the bytes can serve it.

## Decision

**One Torii node, packaged for every home. The world is addressed by npub, never by host.**

1. **One set of images.** The existing `web` / `arena-ws` / `strfry` images are the only runtime. They're built reproducibly in CI from the release tag, multi-arch (amd64 + arm64), and pinned by digest. Platform wrappers only describe how to run them; there is no second codebase.
2. **Four install targets:**
   - **VPS:** torii-suite (today).
   - **Laptop:** `docker compose up` on localhost. Solo or LAN play works offline; a tunnel makes it public.
   - **Umbrel:** a Torii community app store repo (`umbrel-app-store.yml` + `torii-quest/`):
     - the game paths are public: the app proxy's auth is skipped for the game, `/mp` and `/relay`;
     - operator pages stay behind Umbrel login;
     - data lives in `${APP_DATA_DIR}`.
   - **Start9:** a `torii-quest-startos` wrapper building an `.s9pk`:
     - interfaces: a public game UI and a private admin UI;
     - backups of the data volume;
     - published first to a self-hosted registry, then submitted to the Community Registry.
3. **Many addresses, one identity.** The world reference gains optional `endpoint` tags, an additive change to the frozen Gate v1 data. Each tag holds a URL with a transport hint: `https`, `onion`, `lan`.
   - Clients pick the first reachable one, preferring the transport the visitor is already on.
   - The manifest stays hash-verified, so a mirror, onion or tunnel can't alter a world.
   - Endpoints change; the npub and manifest hash don't.
4. **Self-federation without a centre.** Every node runs its own relay and publishes its own signed world reference. Worlds are discovered through follows (NIP-02) and shared relays, not a directory. A node may mirror a friend's manifest (Blossom) to keep it reachable while the friend's laptop sleeps.
5. **Keys stay with people.**
   - A player's nsec never touches any node: login is NIP-07 / NIP-46.
   - A node's own beacon key is generated on the device, stays in its data volume, and is covered by the platform's backup.
   - No secret is ever baked into an image.
6. **Updates are the operator's choice.** Umbrel and StartOS updates are user-initiated, which matches the rule that each operator approves updates to their own node. No platform wrapper auto-updates.
7. **Free software.** Quest stays GPL-3.0, the Gate spec CC0 and the conformance kit 0BSD; every wrapper repo is public.

## Consequences

- **Enables:**
  - running a world on hardware you already own, alongside your Bitcoin node;
  - worlds that survive a host going away (another endpoint or a mirror serves the same hash);
  - onion-only worlds for privacy;
  - LAN parties with no internet.
- **Forecloses:** platform-specific forks of the game, and any central world directory as a requirement.
- **Trade-offs:**
  - three packaging formats to keep current. Mitigation: one image set, CI-built, one smoke test per wrapper;
  - onion endpoints work only in Tor-capable browsers;
  - real-time play over Tor has higher latency;
  - a sleeping laptop world is offline unless mirrored.
- **Security notes:**
  - **CSP:** the web image adds `wss://$DOMAIN` to `connect-src`. On Umbrel and Start9 the host name varies (LAN, onion, tunnel), so the wrappers must rely on same-origin `'self'` for `/mp` and `/relay` instead of a fixed domain;
  - Umbrel's `app_proxy` must never expose operator pages without login;
  - relays on home nodes keep the existing write policy (owner and allow-listed events only).
- **Enforcement:**
  - wrapper CI builds the `.s9pk` and validates the Umbrel store;
  - a smoke test boots each wrapper and checks `release-metadata.json`, `/mp` HELLO and the relay;
  - `endpoint` parsing gets the same hardening tests as `relay` tags.

## Milestones (each its own release, with its own receipt)

- **N1, Umbrel:** community app store repo; real-device install, play, update and uninstall on the owner's Umbrel.
- **N2, Start9:** `.s9pk` wrapper (StartOS 0.4) with public and admin interfaces and backups; real-device test, then a self-hosted registry.
- **N3, endpoints:** `endpoint` tags in the world reference (onion, LAN, tunnel), client reachability choice, and a mirror for sleeping nodes.
- **N4, laptop:** a one-command local node (compose on localhost) with an optional tunnel. It later folds into Torii DE.
- **N5, federation hygiene:** a node health page (relay, `/mp`, last mirror sync), plus documentation for running a world on each target.

## Alternatives considered

- **A hosted service:** fast, but defeats sovereignty.
- **Native installs per platform** (no containers): more code to keep in sync, and neither platform supports it well.
- **Host-addressed worlds** (a URL as the identity): breaks the moment a home IP, onion or tunnel changes. The npub plus manifest hash already solves this.

## Open owner decisions

1. **Order:** Umbrel first (proposed: the compose stack exists, so it's the lowest effort), or Start9 first.
2. **Devices:** which Umbrel and/or Start9 device can be used for real-device testing, and whether it's x86 or ARM.
3. **Public reachability for home nodes:** StartTunnel / Tailscale Funnel / a friend's VPS as a tunnel, or onion + LAN only at first.
4. **Repos:** a wrapper repo per platform under ChiefmonkeyArt (`torii-umbrel-store`, `torii-quest-startos`), or folders in torii-suite.
