# Torii Quest — VPS Install & Manual Update (torii.quest)

> **Status:** host-side documentation only (v0.2.144-alpha). **No code in this
> repo touches a server, performs an install, or auto-updates.** This page
> describes how a maintainer would self-host the static build at `torii.quest`
> on a shared Ubuntu VPS and update it BY HAND from GitHub. Deploying remains a
> deliberate manual step — see `HANDOFF.md` §7 and the safety boundary in
> `UPDATE_CHECK.md` §4.

Torii Quest builds to a **static `dist/` bundle** (Vite 8). There is no backend,
no database, and no server-side runtime — the game runs entirely in the browser
(Three.js + Rapier WASM + Nostr relays the client talks to directly). That means
hosting is "serve a folder of static files over HTTPS." Everything below follows
from that.

---

## 1. MVP recommendation

**Build the static bundle, serve `dist/` with Caddy (or Nginx) on Ubuntu
22.04/24.04 LTS.** Caddy is the lowest-effort path because it obtains and renews
HTTPS certificates automatically. Nginx is the option if you already run it or
need its ecosystem.

You do **not** need Node running in production — Node is only used to *build*.
You can even build elsewhere (CI or your laptop) and copy `dist/` to the VPS, so
the server never needs a toolchain at all.

---

## 2. Minimum VPS requirements

| Resource | Minimum | Comfortable |
|---|---|---|
| OS | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |
| RAM | 1 GB (serve only) / 2 GB (build on box) | 2–4 GB |
| vCPU | 1 | 2 |
| Disk | 5 GB | 10 GB+ (keeps several release tarballs for rollback) |
| Network | Public IPv4 (IPv6 optional), ports 80 + 443 open | + HTTP/3/QUIC (UDP 443) |

Static serving is light; the only spike is the **build** step (Rapier WASM +
Three.js bundle). On a 1 GB box, build elsewhere and copy `dist/` over.

---

## 3. DNS checklist for torii.quest

Point the apex and `www` at the VPS, then verify before touching the server:

- [ ] `A` record: `torii.quest` → VPS IPv4.
- [ ] `AAAA` record: `torii.quest` → VPS IPv6 (only if the VPS has one).
- [ ] `CNAME` (or `A`): `www.torii.quest` → `torii.quest` (Caddy/Nginx can redirect to apex).
- [ ] TTL low (300s) during cutover; raise it once stable.
- [ ] No conflicting `CAA` record blocking Let's Encrypt (if a `CAA` exists, include `letsencrypt.org`).
- [ ] Confirm propagation: `dig +short torii.quest A` and `dig +short www.torii.quest` return the VPS IP from multiple resolvers.
- [ ] Ports 80 and 443 reachable (ACME HTTP-01 needs 80; serving needs 443).

DNS must resolve **before** Caddy starts, or the automatic certificate request
will fail.

---

## 4. Node 20+ (only if building ON the VPS)

Skip this entirely if you build elsewhere and copy `dist/`. To build on the box:

```bash
# Node 20 LTS via NodeSource (Ubuntu)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # expect v20.x or newer
npm -v
```

Torii Quest targets Vite 8 / modern Node; **Node 20+ is the floor**.

---

## 5. Get the code, build, place the bundle

Run as a **least-privilege deploy user** (see §9), not root:

```bash
# 1. clone (first time)
git clone https://github.com/<owner>/torii-gate.git ~/torii-src
cd ~/torii-src

# 2. install exact, reproducible deps and build
npm ci
npm run build        # -> produces ./dist
npm run check        # static guardrails (optional but recommended)

# 3. publish the built bundle into a versioned release folder
VER=$(node -p "require('./package.json').version")
sudo mkdir -p /var/www/torii.quest/releases/$VER
sudo cp -a dist/.  /var/www/torii.quest/releases/$VER/

# 4. flip the "current" symlink atomically
sudo ln -sfn /var/www/torii.quest/releases/$VER /var/www/torii.quest/current
```

Serving the symlink `current/` (not a release folder directly) is what makes
updates and rollbacks atomic — you only ever re-point one link.

> Replace `<owner>` with the real GitHub owner. The actual clone URL is a
> maintainer detail; this repo intentionally hard-codes no server identity.

---

## 6a. Serve with Caddy (recommended — automatic HTTPS)

```bash
# install Caddy (official apt repo)
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

`/etc/caddy/Caddyfile`:

```caddyfile
torii.quest, www.torii.quest {
    root * /var/www/torii.quest/current
    encode zstd gzip
    file_server

    # SPA-ish fallback: the game is a single index.html entry point
    try_files {path} /index.html

    # WASM must be served with the right type for streaming instantiation
    @wasm path *.wasm
    header @wasm Content-Type application/wasm

    # static asset caching (hashed Vite filenames are safe to cache hard)
    @assets path /assets/*
    header @assets Cache-Control "public, max-age=31536000, immutable"
    header /index.html Cache-Control "no-cache"
}
```

```bash
sudo systemctl reload caddy
```

Caddy obtains and renews the Let's Encrypt certificate automatically once DNS
(§3) resolves. HTTPS is on by default; HTTP is redirected to HTTPS.

## 6b. Serve with Nginx (alternative)

```bash
sudo apt-get install -y nginx
sudo apt-get install -y certbot python3-certbot-nginx   # for HTTPS
```

`/etc/nginx/sites-available/torii.quest`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name torii.quest www.torii.quest;
    root /var/www/torii.quest/current;
    index index.html;

    gzip on;
    gzip_types text/css application/javascript application/wasm image/svg+xml;

    location / {
        try_files $uri $uri/ /index.html;
    }

    types { application/wasm wasm; }

    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
    location = /index.html {
        add_header Cache-Control "no-cache";
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/torii.quest /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
# add HTTPS (edits the server block in place, sets up auto-renew):
sudo certbot --nginx -d torii.quest -d www.torii.quest
```

certbot installs a systemd timer for renewal; verify with
`sudo certbot renew --dry-run`.

---

## 7. Manual update from GitHub (main or a release tag)

Updates are a deliberate, human-run sequence. **No part of this is automated, and
the running app cannot trigger it** (see `UPDATE_CHECK.md` §4 — the in-app
update-check is read-only and `actionable:false`).

```bash
cd ~/torii-src

# from main:
git fetch origin
git checkout main
git pull --ff-only origin main

# OR from a specific release tag:
# git fetch --tags origin
# git checkout v0.2.144-alpha

# rebuild reproducibly
npm ci
npm run build
npm run check

# publish into a NEW versioned release folder
VER=$(node -p "require('./package.json').version")
sudo mkdir -p /var/www/torii.quest/releases/$VER
sudo cp -a dist/.  /var/www/torii.quest/releases/$VER/

# atomically switch live traffic to the new build
sudo ln -sfn /var/www/torii.quest/releases/$VER /var/www/torii.quest/current

# no reload needed (static files) — but reloading is harmless:
# sudo systemctl reload caddy   # or nginx
```

Smoke test after every flip: load `https://torii.quest`, confirm the version
label in-game matches `$VER`, fire a shot, open a preview card.

---

## 8. Rollback

Because each build lives in its own `releases/<version>/` folder and `current` is
just a symlink, rollback is one command — **re-point the link at the previous
release**:

```bash
ls -1 /var/www/torii.quest/releases            # see what you have
sudo ln -sfn /var/www/torii.quest/releases/<previous-version> /var/www/torii.quest/current
```

Keep at least the **2–3 most recent** release folders. Optionally archive a
tarball before pruning:

```bash
tar -C /var/www/torii.quest/releases -czf ~/torii-backups/$VER.tar.gz $VER
```

Prune old releases manually once disk pressure warrants it — never the one
`current` points at.

---

## 9. Security notes

- **No auto-update.** Nothing on the server polls GitHub or rebuilds on its own.
  The in-app update-check (`UPDATE_CHECK.md`) only *informs*; it never installs.
- **No shell/admin endpoint is exposed.** The deployed surface is static files.
  Do not add a "rebuild" or "update" HTTP route without the guarded design in §10.
- **Least-privilege deploy user.** Create a non-root `deploy` user that owns
  `~/torii-src` and can `cp`/`ln` under `/var/www/torii.quest`. Run the web
  server as its own service account (`caddy`/`www-data`). Avoid building or
  deploying as root.
- **Firewall basics (UFW):**
  ```bash
  sudo ufw default deny incoming
  sudo ufw default allow outgoing
  sudo ufw allow OpenSSH
  sudo ufw allow 80,443/tcp
  # sudo ufw allow 443/udp   # only if using HTTP/3
  sudo ufw enable
  ```
- **SSH hardening:** key-only auth (`PasswordAuthentication no`), no root SSH
  login (`PermitRootLogin no`), consider `fail2ban`.
- **Keep the host patched:** `unattended-upgrades` for OS security updates (this
  patches the *server*, not the game — the game is updated by hand per §7).
- **Backups:** keep the GitHub repo as the source of truth, plus the release
  tarballs (§8) and the web-server config (`/etc/caddy` or `/etc/nginx`) in a
  backup or config repo.
- **HTTPS only** — both server options above redirect HTTP→HTTPS.

---

## 10. Future "update button" architecture (NOT built yet)

If a guarded in-app/maintainer update affordance is ever added, it must preserve
the safety boundary. Sketch only — **do not implement without explicit sign-off:**

1. **Check (read-only).** Browser or a small server helper reads the GitHub
   releases endpoint (`RELEASE_SOURCE` in `UPDATE_CHECK.md`) and compares against
   the running `VERSION`. This is exactly what the shipped, inert update-check
   view-model already models — it stays `actionable:false`.
2. **Confirm (human).** Surface "vX is available" and require an explicit,
   authenticated maintainer confirmation. No anonymous visitor can trigger it.
3. **Server-side guarded update.** A locked-down, authenticated endpoint runs the
   exact §7 sequence (`git fetch` → checkout pinned tag → `npm ci` → `npm run
   build` → `npm run check` → publish release folder → flip symlink). It must:
   - run as the least-privilege deploy user, never root;
   - pin to a **signed/verified release tag**, never arbitrary input;
   - reject any user-supplied command/branch (no shell interpolation);
   - be rate-limited and audit-logged.
4. **Rollback.** On failed `check`/smoke test, automatically re-point `current` at
   the previous release (§8) and alert the maintainer.

Until that design is reviewed and authorised, **updates stay 100% manual** and the
app ships no update action.

---

## 11. SPA `/zone/*` fallback readiness (v0.2.185)

The gateway travel feature pushes same-origin `/zone/<slug>` URLs (the v0.2.181 portal hop +
the v0.2.182 client-side route parser). For an *in-app* hop this is fully handled. For a
**cold hard-refresh / shared deep-link** to `/zone/<slug>` the static host must serve
`index.html` for that unmatched path — otherwise the host 404s before any JS runs. Both
serve blocks above already carry this directive:

- **Caddy (§6a):** `try_files {path} /index.html`
- **Nginx (§6b):** `try_files $uri $uri/ /index.html;`
- **Static CDN / object storage:** set the SPA / 404 fallback document to `index.html`.

Before publishing a new `dist/`, run the repo's local, read-only, network-free readiness
check (no server needed):

```bash
npm run build && npm run zones:check
```

It FAILS if these docs stop describing the `/zone/*` → `index.html` fallback, if the built
bundle has no `index.html`, or if a static file is published under `dist/zone/*` that would
shadow the fallback. The same guard runs inside `npm run check` (regression-check [15]) and
the release gate. The full pre-publish checklist + non-goals live in
`ZONE_FALLBACK_READINESS.md`. Configuring the real host fallback remains a manual maintainer
step — this repo touches no server.
