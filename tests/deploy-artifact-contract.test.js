// tests/deploy-artifact-contract.test.js — locks the clean-install server
// artifact contract (audit F03/F04). Release candidates for the multiplayer
// server must ship BOTH external runtime deps (ws AND draco3d) from the ONE
// generated manifest (tools/write-server-runtime-manifest.mjs), and the Docker
// proxy must preserve the /mp prefix and append — never replace — connect-src.
// Source-level assertions only; no Docker/network is run here.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const caddyfile = readFileSync(new URL('../Caddyfile', import.meta.url), 'utf8');
const bareMetalSh = readFileSync(new URL('../install/lib/bare-metal.sh', import.meta.url), 'utf8');

describe('F03 — clean installs ship the runtime deps from one artifact', () => {
  it('Dockerfile arena-ws stage installs from the generated manifest, not ws@8 only', () => {
    // Consume dist/package.json (which declares BOTH ws + draco3d)…
    expect(dockerfile).toMatch(/COPY --from=build \/app\/dist\/package\.json \.\/package\.json/);
    // …and never a bare ws-only install.
    expect(dockerfile).not.toMatch(/npm install[^\n]*ws@8/);
    expect(dockerfile).toMatch(/npm install --omit=dev/);
  });

  it('bare-metal.sh copies the generated manifest instead of a hand-written ws-only one', () => {
    expect(bareMetalSh).toMatch(/cp '\$ROOT\/dist\/package\.json' '\$MP_DIR\/package\.json'/);
    // The old hand-rolled manifest hard-coded only ws and omitted draco3d.
    expect(bareMetalSh).not.toMatch(/"dependencies":\s*\{\s*"ws":\s*"\^8\.18\.0"/);
    expect(bareMetalSh).not.toMatch(/ws only/);
  });

  it('draco3d remains a declared production dependency (startup-time import)', () => {
    // The manifest tool externalises exactly ws + draco3d; both must stay real
    // dependencies so a clean install resolves them. This is the headless-GLB
    // startup path — the server crashes without draco3d present.
    expect(bareMetalSh).toMatch(/BOTH ws and draco3d|ws \+ draco3d/);
  });
});

describe('F04 — Docker proxy preserves /mp and canonical CSP', () => {
  it('Caddyfile routes /mp with handle (preserve) not handle_path (strip)', () => {
    expect(caddyfile).toMatch(/handle \/mp \{/);
    expect(caddyfile).toMatch(/handle \/mp\/\* \{/);
    expect(caddyfile).not.toMatch(/handle_path \/mp\b/);
  });

  it('Caddyfile still strips /relay for strfry (relay listens on /)', () => {
    expect(caddyfile).toMatch(/handle_path \/relay/);
    expect(caddyfile).toMatch(/handle_path \/relay\/\*/);
  });

  it('Dockerfile appends wss://$DOMAIN to the canonical connect-src, never replaces the relay list', () => {
    // Append-only: the sed rewrites the existing connect-src value, keeping the
    // Gamestr/Routstr/Vertex/Plebeian relays from tools/csp.mjs.
    expect(dockerfile).toMatch(/connect-src\[\^;\]\*\)#\\1 wss:\/\/\{\$DOMAIN\}/);
    // The stale replacement form (which dropped those relays) must be gone.
    expect(dockerfile).not.toMatch(/CSP%connect-src\*\}/);
    expect(dockerfile).not.toMatch(/wss:\/\/relay\.damus\.io/);
  });
});

const arenaWs = readFileSync(new URL('../server/arena-ws.js', import.meta.url), 'utf8');

describe('F07 — the plaintext server binds loopback, never 0.0.0.0, on host', () => {
  it('server HOST default is loopback, not the public 0.0.0.0', () => {
    // A host deployment that does not set HOST must fall back to loopback so
    // the raw port never faces the internet; only the reverse proxy reaches it.
    expect(arenaWs).toMatch(/const HOST\s+= process\.env\.HOST \|\| '127\.0\.0\.1'/);
    // The old wildcard default is the F07 leak — must be gone.
    expect(arenaWs).not.toMatch(/process\.env\.HOST \|\| '0\.0\.0\.0'/);
  });

  it('container opts back into container-internal 0.0.0.0 explicitly', () => {
    // Inside a container the process must listen on 0.0.0.0 so the sibling
    // reverse-proxy container on the compose network can reach it — but it is
    // explicit here, and docker-compose publishes no host port.
    expect(dockerfile).toMatch(/^ENV HOST=0\.0\.0\.0$/m);
  });

  it('bare-metal systemd unit pins HOST=127.0.0.1 (no unit drift to wildcard)', () => {
    expect(bareMetalSh).toMatch(/Environment=HOST=127\.0\.0\.1/);
    expect(bareMetalSh).not.toMatch(/Environment=HOST=0\.0\.0\.0/);
  });
});

describe('F08 — connection caps bound per-client ingress/egress', () => {
  it('WebSocketServer sets an explicit maxPayload before parsing inbound frames', () => {
    // No explicit maxPayload leaves ws at its 100 MiB default; a small arena
    // frame must be rejected long before that.
    expect(arenaWs).toMatch(/new WebSocketServer\(\{ noServer: true, maxPayload: MAX_WS_PAYLOAD_BYTES \}\)/);
    expect(arenaWs).toMatch(/const MAX_WS_PAYLOAD_BYTES = 64 \* 1024/);
  });

  it('send helpers terminate slow readers via bufferedAmount, never buffer unbounded', () => {
    expect(arenaWs).toMatch(/bufferedAmount > MAX_BUFFERED_BYTES/);
    expect(arenaWs).toMatch(/const MAX_BUFFERED_BYTES\s+= 1 \* 1024 \* 1024/);
  });
});