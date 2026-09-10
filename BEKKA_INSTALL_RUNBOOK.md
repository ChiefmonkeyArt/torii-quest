# Bekka's Torii Quest Install Runbook (v0.2.813-alpha)

A one-page guide for a **fresh, clean install** on a new Ubuntu/Debian VPS that
ends with a running Torii Quest identical to `chiefmonkey.art/quest` — with
**your own admin identity**, **your own uploaded character**, and an in-world
Nakama NPC that greets you by name.

You will need:

- A fresh Ubuntu 22.04+ or Debian 12+ VPS with root SSH access.
- A domain you control (e.g. `bekka.art`) pointing to the VPS IP.
- Your Nostr npub (starts with `npub1...`) — the identity you will use as
  admin. It's the one you already log in with in your Nostr client.
- An email address for Let's Encrypt certificate notices.

The whole install is one command. **No Docker required.**

---

## 1. Point DNS at the VPS

Create an `A` record for your domain (say `bekka.art`) pointing to the VPS
public IP. Verify from your laptop:

```bash
dig +short bekka.art
```

You should see the VPS IP. If not, wait a few minutes for DNS to propagate.

---

## 2. Clone and install

SSH into the VPS as root (or a sudoer), then:

```bash
git clone https://github.com/ChiefmonkeyArt/torii-quest.git && cd torii-quest && sudo ./install.sh
```

The installer will prompt you for three things:

1. **Domain** — `bekka.art` (or whichever you set up).
2. **Let's Encrypt email** — `you@example.com`.
3. **Admin npub** — the `npub1...` you want to claim admin with. This gets
   written to `.env` as `QUEST_ADMIN_NPUB=npub1...` and plumbed into the
   multiplayer server at startup.

The installer will then:

- Install Node 20 + Caddy on the box.
- Build the game and publish a versioned release folder with an atomic
  symlink flip.
- Run the multiplayer server under systemd as user `torii-quest`.
- Configure Caddy with auto-HTTPS + a `/mp` reverse proxy to the MP server.

Total time: ~3–5 minutes on a small VPS.

To pre-fill everything and run non-interactively, pass the flags directly:

```bash
sudo ./install.sh \
  --domain bekka.art \
  --email you@example.com \
  --admin-npub npub1yourNpubHere... \
  -y
```

To rehearse the run without touching the box first (checks DNS + parses
config, then exits):

```bash
sudo ./install.sh \
  --domain bekka.art \
  --email you@example.com \
  --admin-npub npub1yourNpubHere... \
  --dry-run -y
```

---

## 3. First login — claim admin

Open `https://bekka.art/` in your browser. You will see the title screen.

Click **LOGIN NOSTR** and sign in using the **same npub** you gave to the
installer. The site will recognise you as the claimed admin and switch the
homepage greeting to `Welcome, <YourName>` in Torii orange (pulled from your
Nostr `kind:0` display name).

---

## 4. Upload your character (Character Forge)

Open the **Character** tab. Drop in a rigged `.glb` file (any humanoid,
Meshy-style rig works out of the box). The Character Forge pipeline runs
automatically:

1. **Rig assessment** — verifies your GLB matches the portable-character
   contract (skeleton + weights + expected bones).
2. **Blossom upload** — uploads the GLB to your Blossom server (defaults to
   `https://n.primal.net`) using a BUD-11 signed auth event.
3. **Auto-headless FP variant** — the server generates a headless first-person
   variant of your model so your own POV doesn't show your character's head
   clipping into the camera. This is also uploaded to Blossom.
4. **Portrait render** — an auto-portrait is rendered and uploaded.
5. **Publish** — a `kind-35100` character manifest is published to your Nostr
   relays, pinning your character to your npub.

You'll see the character appear in the picker.

---

## 5. Meet your Nakama

Walk into the NAP zone (the safe social area at the centre of the map). You'll
find your Nakama NPC — a friendly greeter that:

- Renders visually as the shared Nakama base model.
- Wears an orange nameplate above its head that reads **`<YourNostrName>
  Nakama`** (e.g. `BitcoinBekka Nakama`).
- Walks and gestures using the same rig as your character.

Before your Nostr `kind:0` name resolves — or if you haven't logged in yet —
the nameplate reads `Nakama` on its own. Once your profile name loads (usually
within a second), the label updates live.

Every visitor to your instance will see the same `BitcoinBekka Nakama` label,
regardless of who they log in as — the Nakama's identity mirrors the instance
**owner**, not the viewer.

---

## Expected end state

- `https://bekka.art/` serves the Torii Quest title screen with your name
  in the greeting once you log in.
- `https://bekka.art/mp` is the multiplayer WebSocket endpoint (Caddy proxies
  to the systemd-managed `torii-quest` server on `127.0.0.1:8788`).
- Your character `.glb` is published to Blossom + Nostr as a `kind-35100`
  manifest pinned to your npub.
- The in-world Nakama NPC greets you with `<YourNostrName> Nakama`.

---

## Troubleshooting

**"That doesn't look like an npub" warning during install.** The installer
expects a bech32-encoded key starting with `npub1`. If you accidentally paste
a hex pubkey, hit Ctrl+C and re-run with the correct format.

**DNS check fails.** Wait 5 minutes and re-run — DNS propagation can lag. The
installer refuses to enable HTTPS until DNS points at the box.

**Character upload stalls at Blossom.** Blossom needs your Nostr signer (a
NIP-07 extension like Alby, or nsec.app). Make sure the extension is unlocked
and you approved the signature request.

**Nameplate reads `Nakama` (no name).** Your kind:0 profile hasn't resolved
yet or hasn't been published. Publish a profile with a `name` field to any
relay in your list, then reload the page.

**Re-running the installer.** Safe to run again — an existing `.env` is
detected and offered as defaults; nothing is overwritten blind.

---

## Reference

- Source: <https://github.com/ChiefmonkeyArt/torii-quest>
- Live reference instance: <https://chiefmonkey.art/quest/>
- Install flags: `sudo ./install.sh --help`
- Version this runbook targets: **v0.2.813-alpha**
