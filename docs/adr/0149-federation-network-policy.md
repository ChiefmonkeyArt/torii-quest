# ADR-0149: Federation Network Policy (connect-src)

- **Status:** Accepted for stage 1 (owner decision, 2026-10-26: "Do option B, any secure server for now"). Stages 2 and 3 are planned and remain Proposed until the owner approves each one.
- **Date:** 2026-10-26
- **Deciders:** chiefmonkey
- **Related:**
  - ADR-0003 (CSP as an HTTP header), ADR-0067 / ADR-0120 (relay allowlist in lockstep with the default relays), ADR-0104 (no vertexlab);
  - ADR-0147 (sovereign metaverse: federation, M2 gateway napplet, M3 travel), ADR-0148 (one node, every home, Proposed);
  - `tools/csp.mjs`, `vite.config.js` (`_headers`, `csp.nginx.conf`), `Dockerfile` / `install/lib/bare-metal.sh` (Caddy), `tests/csp-relay-sync.test.js`.

## Context

The page's Content-Security-Policy `connect-src` named a fixed list of relays plus `https://api.github.com`. Federation means a traveller's browser must reach **other nodes'** endpoints:

- their Nostr relays (world references, heartbeats);
- their multiplayer sockets (`wss://<node>/mp`);
- Blossom media servers named in world references (e.g. `https://blossom.primal.net/`).

Wherever the policy is enforced (Docker and bare-metal installs through Caddy, static hosts reading `_headers`), all of these were blocked. chiefmonkey.art (nginx, torii-suite) sent no CSP header at all, so travel worked there only because nothing was enforced.

Four options were weighed (session 2026-10-25):

| Option | For | Against |
|---|---|---|
| A. Keep the fixed list | Tightest exfiltration control | Federation broken where enforced; every new node needs a release |
| B. Any secure server (`https:` `wss:`) | Federation just works; simple | Loses the connect-src layer against injected code |
| C. Operator-preferred list built at deploy | Operator control; still tight | Upkeep; visitors can't reach unlisted worlds |
| D. Split: tight main page + a sandboxed network helper with open connect-src | Best of both | Most work; another origin to deploy |

## Decision

**Stage 1 (now, v0.2.935): option B.** `connect-src 'self' blob: https: wss:`.

- Any **secure** server is reachable. Plain `http:`, `ws:`, `*` and `data:` stay blocked (tests and the regression check enforce this).
- The real defence against injected code is unchanged and stays strict: `script-src 'self' 'wasm-unsafe-eval' '<bootstrap sha>'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-src 'self'` (only the gateway napplet). Keys stay in the signer (NIP-07), never in the page.
- The update check (`https://api.github.com`) is covered by `https:`.

**Preparation for stages 2 and 3 (shipped, inactive):**

- `tools/csp.mjs` builds `connect-src` with `connectSrcFor(mode, { extra })`:
  - `CONNECT_MODES.OPEN` (active);
  - `CONNECT_MODES.PREFERRED`: the curated `PREFERRED_CONNECT_SOURCES` list (kept in lockstep with `DEFAULT_NODE_RELAYS`) plus operator additions, which must be bare `https://` / `wss://` origins (`isOperatorConnectSource`).
- Every build emits `dist/csp.nginx.conf` (one `add_header` line with the per-build bootstrap hash) next to `_headers`, so nginx nodes can enforce the policy.

**Stage 2 (Proposed): open federated + operator-preferred list.** A node operator can choose `preferred` (a closed list: the curated set plus their own trusted nodes/relays/media) or stay `open`. Proposed shape: an operator setting read at build/deploy time; the gateway marks worlds outside the list as "not reachable from this node" instead of failing silently.

**Stage 3 (Proposed): split.** The main page returns to a tight list. Cross-node network work (world references, Blossom fetches, other nodes' relays) moves into a sandboxed helper on its own origin with open `connect-src`, which returns only validated data (signature- and hash-checked) over `postMessage`.

### Review triggers (the reminder)

Revisit and move to stage 2 or 3 when **any** of these happens:

1. any third-party content is rendered as markup in the main page (today everything foreign is text-only or validated data);
2. a CSP or XSS-class bug is reported against Quest;
3. more than about 10 independent nodes federate, or an operator asks for a closed list;
4. the node starts holding secrets in the page (it must not; see the signer rule above);
5. before ADR-0148 ships Start9 / Umbrel packages, since those operators expect a closed default.

These are also tracked in `torii-quest-todo.md` under "Federation network policy".

## Enforcement status

- **Docker / bare-metal (Caddy):** enforced from v0.2.935 (they add `wss://<domain>`, which `wss:` already covers).
- **Static hosts reading `_headers`:** enforced.
- **chiefmonkey.art (nginx via torii-suite):** **not enforced yet.** The bootstrap hash changes every build, so a hand-pasted header would break the page on the next deploy. Enabling it is a torii-suite change, approved by each operator for their own VPS:
  - `include /apps/quest/current/csp.nginx.conf;` in the Quest location (path per the install);
  - `nginx -t && systemctl reload nginx` in the update runner after the release swap.

## Consequences

- Federation works on every install that enforces the policy.
- An injected script could send data to any https/wss server. Mitigated by the strict script policy, text-only rendering of foreign content, and keys never touching the page. The review triggers above decide when to tighten.
- Operators keep the choice (stage 2) without a code change to the game.
