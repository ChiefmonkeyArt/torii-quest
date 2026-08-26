# Torii Quest

An open-world arena shooter built on [Nostr](https://nostr.com) and Bitcoin.

**Sats. Shots. Sovereignty.**

🎮 **Play now:** [torii-quest.pplx.app](https://torii-quest.pplx.app)

---

## About

Torii Quest is a browser-based multiplayer arena shooter where players battle for sats in a Japanese-inspired open world. Built entirely with open-source tools — no big tech, no cloud lock-in.

The game is a gateway to a decentralised open world powered by the Nostr protocol. Free market economics (Gamma Markets, Plebeian) as rational infrastructure for prosperous communities. Optimistic cypherpunk — hi-tech in balance with nature.

## Features

- **Nostr login** — sign in with your Nostr key via browser extension (e.g. Plebeian Signer)
- **Bitcoin/ecash rewards** — earn sats for kills
- **3D arena** — Three.js / WebGL renderer with physics via Rapier
- **Atmospheric world** — sunrise skybox, mountain ranges, instanced trees, drifting ground mist, birds
- **Torii gate** — 313KB optimised GLB centrepiece, Draco + WebP compressed
- **Playable characters** — Chiefmonkey and Nostrich (rigged GLB, 18–19 animation clips each)
- **Enemy bots** — Banker bots with full animation set including `Shot_and_Blown_Back` death physics
- **Mirror** — live Reflector on the west wall, throttled to 20Hz for performance
- **Service worker** — offline-capable, cache-first for assets, network-first for JS

## Tech Stack

| Layer | Technology |
|---|---|
| Renderer | Three.js r184 (WebGL) |
| Physics | Rapier3D (WASM) |
| Protocol | Nostr (NIP-01, NIP-07) |
| Payments | Bitcoin / ecash (fake sats in alpha) |
| Build | Vite 8 |
| 3D Models | Blender → glTF/GLB (Draco compressed) |
| Deployment | pplx.app |

## Controls

| Key | Action |
|---|---|
| W A S D | Move / strafe |
| ← → ↑ ↓ | Move / strafe (identical) |
| Mouse | Look |
| Click | Shoot |
| Space | Jump |
| R | Reload |
| ESC | Pause / resume |

## Self-hosting

Run the full game (static site + multiplayer arena + auto-HTTPS) on your own
Ubuntu/Debian VPS in one command. Clone the repo and run the installer:

```bash
git clone https://github.com/ChiefmonkeyArt/torii-quest.git
cd torii-quest
sudo ./install.sh
```

That's it. The installer is the **recommended bare-metal path**: it installs
Node 20 + Caddy, builds the game, publishes it into a versioned release
folder with an atomic symlink flip, runs the multiplayer server under
systemd as a dedicated `torii-quest` user, and configures Caddy with
automatic HTTPS and a `/mp` reverse proxy — all decoupled from torii-suite.

The **only prompts** are your domain, a Let's Encrypt email, and your admin
npub. Point a DNS A record at your server first, then run the command above.

Docker is available as an **advanced/optional** alternative for operators who
prefer container isolation:

```bash
sudo ./install.sh --docker
```

See [VPS_INSTALL.md](VPS_INSTALL.md) for the full manual reference, rollback,
and security hardening details.

## Development

```bash
npm install
npm run dev      # local dev server
npm run build    # production build → dist/

# tests
npm test             # full Vitest suite (node env)
npm run test:fast    # ~5 core pure files — quick inner loop
npm run test:foundation  # ~16 pure/guard files — broader pre-commit check
npm run test:release # full release gate: build + Vitest + check + bundle + handoff
```

Requires Node 18+. Use `test:fast`/`test:foundation` while iterating, but every
public deploy/publish must pass `npm run test:release` (or equivalent full verification).

## Project Structure

```
src/
  atmosphere.js   # Mountains, trees, mist, birds
  arena.js        # Arena geometry + torii gate GLB
  bots.js         # Bot AI, spawning, kill/revive
  botModel.js     # Banker GLB loader + AnimationMixer
  bullets.js      # Bullet pool
  config.js       # All game constants
  events.js       # Event bus
  hud.js          # HUD overlay
  input.js        # Keyboard + mouse + pointer lock
  lod.js          # Level of detail
  loop.js         # rAF game loop
  main.js         # Wiring only — no game logic
  mirror.js       # Live Reflector mirror
  minimap.js      # Canvas minimap
  nostr.js        # Nostr protocol integration
  physics.js      # Rapier world + colliders
  player.js       # Player movement, shoot, respawn
  playerModel.js  # Player GLB loader + animations
  scene.js        # Three.js scene, sunrise sky, fog
  state.js        # Game state machine
  weapons.js      # Bullet pool, gun viewmodel, hit detection
public/
  banker-rigged.glb
  chiefmonkey6.glb
  nostrich3.glb
  torii-gate.glb
  gun-steampunk.glb
  bitcoin-b.png
  sw.js           # Service worker
```

## Philosophy

> *The torii gate marks the threshold between the ordinary world and the sacred. In Torii Quest, it marks the threshold between the old financial system and a free, open, decentralised one.*

Nostr is the social layer. Bitcoin is the economic layer. The game is the fun layer.

## License

[GNU General Public License v3.0](LICENSE) — open source, copyleft, free to fork and build on.

## Credits

- Built by [Chiefmonkey](https://github.com/chiefmonkey) and AI agents
- Character models: Tripo3D / Mixamo
- Torii gate model: Tripo3D (optimised with `gltf-transform`)
- Physics: [Rapier](https://rapier.rs)
- Protocol: [Nostr](https://nostr.com)
