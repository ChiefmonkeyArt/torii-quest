// tests/installer-bare-metal.test.js — source-contract tests for the unified
// install.sh (ADR-0066). Bare-metal is the default/recommended install path;
// Docker is an advanced/optional alternative gated behind --docker. These
// tests assert the contract at the source level (script text + docs), not by
// actually running an install (that needs a real VPS — see the installer's
// own --dry-run smoke test instead).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const installSh = readFileSync(new URL('../install.sh', import.meta.url), 'utf8');
const bareMetalSh = readFileSync(new URL('../install/lib/bare-metal.sh', import.meta.url), 'utf8');
const dockerSh = readFileSync(new URL('../install/lib/docker.sh', import.meta.url), 'utf8');
const dockerCompose = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const vpsInstallMd = readFileSync(new URL('../VPS_INSTALL.md', import.meta.url), 'utf8');

describe('install.sh — bare-metal default, Docker as an optional flag', () => {
  it('defaults USE_DOCKER to 0 (bare-metal unless --docker is passed)', () => {
    expect(installSh).toMatch(/USE_DOCKER=0/);
  });

  it('only sets USE_DOCKER=1 in response to the --docker flag', () => {
    expect(installSh).toMatch(/--docker\)\s*USE_DOCKER=1/);
  });

  it('branches to run_bare_metal_install when USE_DOCKER is not set, run_docker_install when it is', () => {
    expect(installSh).toMatch(/if \[\[ "\$USE_DOCKER" -eq 1 \]\]; then/);
    expect(installSh).toMatch(/run_docker_install/);
    expect(installSh).toMatch(/run_bare_metal_install/);
  });

  it('is a single user-facing entry point (lib files are sourced, not separate top-level installers)', () => {
    expect(installSh).toMatch(/source "\$ROOT\/install\/lib\/bare-metal\.sh"/);
    expect(installSh).toMatch(/source "\$ROOT\/install\/lib\/docker\.sh"/);
  });

  it('interactive path prompts for domain, email, and admin npub (plus a -y npub-gap prompt)', () => {
    const asks = [...installSh.matchAll(/ui_ask\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(asks).toHaveLength(4);
    expect(asks[0]).toMatch(/Domain/i);
    expect(asks[1]).toMatch(/email/i);
    expect(asks[2]).toMatch(/Admin npub \(optional\)/i);
    // The 4th is the `-y` gap prompt: no admin npub configured → re-ask rather
    // than silently leaving the instance ownerless (no Welcome/Node/Heartbeat).
    expect(asks[3]).toMatch(/claim this instance/i);
  });

  it('supports --domain, --email, --admin-npub, --docker, --dry-run, -y/--yes, -h/--help', () => {
    for (const flag of ['--docker', '--domain', '--email', '--admin-npub', '--dry-run', '--yes', '--help']) {
      expect(installSh).toContain(flag);
    }
  });

  it('--dry-run makes no .env write (config-resolve-and-print only)', () => {
    expect(installSh).toMatch(/if \[\[ "\$DRY_RUN" -ne 1 \]\]; then[\s\S]*?\} > \.env/);
  });

  it('records QUEST_PUBLIC_URL + QUEST_NODE_RELAYS in .env (ADR-0094 beacon website/relays)', () => {
    expect(installSh).toMatch(/echo "QUEST_PUBLIC_URL=https:\/\/\$DOMAIN_IN"/);
    expect(installSh).toMatch(/echo "QUEST_NODE_RELAYS=wss:\/\/main\.relay\.gamestr\.io/);
    expect(dockerCompose).toMatch(/QUEST_PUBLIC_URL: \$\{QUEST_PUBLIC_URL:-\}/);
    expect(dockerCompose).toMatch(/QUEST_NODE_RELAYS: \$\{QUEST_NODE_RELAYS:-wss:\/\/main\.relay\.gamestr\.io/);
  });

  it('never calls run_bare_metal_install or run_docker_install during --dry-run', () => {
    const dryRunBlockMatch = installSh.match(/if \[\[ "\$DRY_RUN" -eq 1 \]\][\s\S]*?exit 0\nfi/);
    expect(dryRunBlockMatch).toBeTruthy();
    expect(dryRunBlockMatch[0]).not.toMatch(/run_bare_metal_install|run_docker_install/);
  });
});

describe('bare-metal install path — matches VPS_INSTALL.md conventions', () => {
  it('installs Node 20+ and Caddy (not Docker) as its only system deps', () => {
    expect(bareMetalSh).toMatch(/deb\.nodesource\.com\/setup_20\.x/);
    expect(bareMetalSh).toMatch(/apt-get install -y caddy/);
    expect(bareMetalSh).not.toMatch(/docker compose|get\.docker\.com/);
  });

  it('builds as a non-root user (SUDO_USER), never forces a root-owned clone', () => {
    expect(bareMetalSh).toMatch(/BUILD_USER="\$\{SUDO_USER:-\$USER\}"/);
    expect(bareMetalSh).toMatch(/sudo -u "\$BUILD_USER" -H npm ci/);
    expect(bareMetalSh).toMatch(/sudo -u "\$BUILD_USER" -H npm run build/);
  });

  it('publishes into a versioned release folder and flips a symlink atomically', () => {
    expect(bareMetalSh).toMatch(/RELEASES_ROOT="\/var\/www\/torii-quest\/releases"/);
    expect(bareMetalSh).toMatch(/CURRENT_LINK="\/var\/www\/torii-quest\/current"/);
    expect(bareMetalSh).toMatch(/ln -sfn "\$REL_DIR" "\$CURRENT_LINK"/);
  });

  it('prunes old releases but never removes the one `current` points at', () => {
    expect(bareMetalSh).toMatch(/Pruning old releases/);
    expect(bareMetalSh).toMatch(/never prune the live release/);
  });

  it('creates a dedicated torii-quest system user for the multiplayer service', () => {
    expect(bareMetalSh).toMatch(/useradd --system --shell \/usr\/sbin\/nologin[\s\S]*torii-quest/);
  });

  it('writes a systemd unit with the documented hardening + env vars from VPS_INSTALL.md §16', () => {
    expect(bareMetalSh).toMatch(/User=torii-quest/);
    expect(bareMetalSh).toMatch(/ExecStart=\/usr\/bin\/node \$MP_DIR\/arena-ws\.cjs/);
    expect(bareMetalSh).toMatch(/Environment=QUEST_ADMIN_NPUB=\$NPUB_IN/);
    // ADR-0094: the server beacon needs the public origin + relay set injected so
    // presence events point at the right world URL and publish to the node relays.
    expect(bareMetalSh).toMatch(/Environment=QUEST_PUBLIC_URL=https:\/\/\$DOMAIN_IN/);
    expect(bareMetalSh).toMatch(/Environment=QUEST_NODE_RELAYS=wss:\/\/main\.relay\.gamestr\.io/);
    expect(bareMetalSh).toMatch(/ProtectSystem=strict/);
  });

  it('writes Caddy config inside a clearly-marked managed block, never clobbering the whole file', () => {
    expect(bareMetalSh).toMatch(/# TORII QUEST MANAGED START/);
    expect(bareMetalSh).toMatch(/# TORII QUEST MANAGED END/);
    // Uses awk to strip only the prior managed block before appending fresh one.
    expect(bareMetalSh).toMatch(/skip=1.*next/);
  });

  it('validates the Caddyfile before reloading — never reloads a config it hasn\'t checked', () => {
    expect(bareMetalSh).toMatch(/caddy validate --config "\$CADDYFILE"/);
    expect(bareMetalSh).toMatch(/if caddy validate[\s\S]*?then[\s\S]*?systemctl reload caddy/);
  });

  it('prefix-matches the /mp handler so /mp AND /mp/* proxy to arena-ws', () => {
    // Caddy path matchers are EXACT unless a wildcard is given, so `handle /mp`
    // proxies the WebSocket handshake at `/mp` but NOT `/mp/admin/update-capability`
    // — the sub-path falls through to the SPA fallback and returns index.html,
    // so an instance can never recognise its owner. The matcher must be the
    // prefix form `/mp /mp/*` (via a named `@mp` matcher so both spellings are explicit).
    expect(bareMetalSh).toMatch(/@mp path \/mp \/mp\/\*/);
    expect(bareMetalSh).toMatch(/handle @mp \{/);
    expect(bareMetalSh).toMatch(/reverse_proxy 127\.0\.0\.1:8787/);
  });

  it('nests the SPA file_server/try_files fallback inside a catch-all handle { } block', () => {
    // Caddy lists `try_files` BEFORE `handle` in directive order, so a bare
    // `try_files {path} /index.html` rewrites /mp/* → /index.html before the
    // `handle /mp` proxy can match — silently breaking multiplayer + the
    // /mp/admin capability endpoint. The fallback must sit in a catch-all
    // `handle { … }` so it and the /mp proxy stay mutually exclusive.
    expect(bareMetalSh).toMatch(/handle \{"[\s\S]*?file_server[\s\S]*?try_files \{path\} \/index\.html/);
  });

  it('extracts the CSP from the build\'s own dist/_headers rather than hand-copying a string', () => {
    expect(bareMetalSh).toMatch(/grep -m1 'Content-Security-Policy' "\$REL_DIR\/_headers"/);
  });

  it('does not claim to install a local Nostr relay on bare metal (relay is Docker-only)', () => {
    // The file's header comment may explain that strfry is Docker-only (a
    // documentation note), but it must never actually install/start it.
    expect(bareMetalSh).not.toMatch(/apt-get install[^\n]*strfry|systemctl (enable|start)[^\n]*strfry|docker[^\n]*strfry/i);
  });

  it('does not modify server/arena-ws.js — only references the pre-built bundle', () => {
    expect(bareMetalSh).not.toMatch(/server\/arena-ws\.js["']?\s*(>|>>|\bcat\b.*>)/);
    expect(bareMetalSh).toMatch(/dist\/server\/arena-ws\.cjs/);
  });
});

describe('docker install path — unchanged behaviour, gated behind --docker', () => {
  it('still includes the strfry relay + arena-ws Docker services', () => {
    expect(dockerSh).toMatch(/docker compose/);
  });

  it('is only reachable via run_docker_install(), never invoked by default', () => {
    expect(dockerSh).toMatch(/run_docker_install\(\)/);
    expect(installSh).not.toMatch(/^run_docker_install\b/m); // not called unconditionally at top level
  });
});

describe('docs — bare-metal framed as recommended, Docker as advanced/optional', () => {
  it('README leads self-hosters to the bare-metal one-liner, not Docker', () => {
    const selfHostSection = readme.slice(readme.indexOf('## Self-hosting'));
    expect(selfHostSection).toMatch(/sudo \.\/install\.sh\n/);
    expect(selfHostSection.indexOf('sudo ./install.sh\n')).toBeLessThan(
      selfHostSection.indexOf('--docker')
    );
    expect(selfHostSection).toMatch(/recommended bare-metal path/i);
    expect(selfHostSection).toMatch(/advanced\/optional/i);
  });

  it('VPS_INSTALL.md §0 recommends bare-metal, not Docker', () => {
    const section0 = vpsInstallMd.slice(
      vpsInstallMd.indexOf('## 0. Quick start'),
      vpsInstallMd.indexOf('## 1. MVP recommendation')
    );
    expect(section0).toMatch(/one-command bare-metal (install|bootstrap) \(recommended\)/i);
    // Docker is explicitly framed as NOT recommended (negation is the desired
    // wording — the contract forbids calling Docker recommended, not the
    // word "recommended" appearing anywhere near "docker").
    expect(section0).toMatch(/\*\*not\*\* the recommended path for most self-hosters/i);
  });

  it('no doc positively calls the Docker path "recommended" (negations like "not the recommended path" are allowed)', () => {
    // Matches a positive recommendation of Docker: "docker" near "recommended"
    // but NOT preceded within the same sentence by a negation (not/never).
    const positiveDockerRec = /(?:^|[^\w])(?!not the recommended)(?!never recommended)docker[^.]*recommended/i;
    for (const [name, text] of [['README.md', readme], ['VPS_INSTALL.md', vpsInstallMd]]) {
      // Split into sentences so a negation in one sentence doesn't bleed into
      // a separate positive claim about Docker in another.
      const sentences = text.split(/(?<=[.!?\n])\s+/);
      for (const s of sentences) {
        const dockerSentences = s.toLowerCase().includes('docker') ? [s] : [];
        for (const ds of dockerSentences) {
          const hasPositiveRec = /recommended/.test(ds) && !/\bnot\b|\bnever\b/i.test(ds);
          expect(hasPositiveRec, `${name}: sentence positively recommends Docker: "${ds.trim()}"`).toBe(false);
        }
      }
    }
  });
});
