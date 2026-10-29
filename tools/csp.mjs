import { createHash } from 'node:crypto';

// tools/csp.mjs — single source of truth for the Content-Security-Policy (S3, v0.2.266).
//
// The CSP ships as an HTTP RESPONSE HEADER, never a <meta> tag. It is emitted in three
// places, all derived from CSP_VALUE here so they cannot drift:
//   1. dist/_headers  — written at build by the vite plugin; honoured by the static host
//      (S3 / chiefmonkey.art, Netlify/Cloudflare-style `_headers`).
//   2. the Vite preview server (production-parity local serving).
//   3. the Caddy / Nginx server blocks documented in VPS_INSTALL.md (VPS deploy path).
//
// script-src uses a sha256 hash for the SINGLE trusted classic inline bootstrap and
// keeps `'self'` for the versioned same-origin ESM entry plus every lazily imported
// chunk (three-vendor, rapier, arenaRuntime, …). At build the Vite plugin removes the
// static entry <script> tag and has the bootstrap `import('/assets/torii-entry.js')`.
// Do not add `'strict-dynamic'`: Chrome ignores host allowlists when it is present but
// does not propagate the bootstrap hash trust through import() for this module graph.
//
// connect-src carries the Nostr relay sockets plus the ONE read-only HTTPS origin the
// update-check needs — https://api.github.com (releases/latest, GET only, cached client-side
// in liveUpdateCheck.js). No script/style/font third-party origin appears anywhere: gstatic.com
// is gone (S4) because the Draco decoder is vendored at /draco/ and fetched same-origin.

// sha256 of the default-root fallback inline bootstrap after `%BASE_URL%` resolves
// to `/` and ENTRY_IMPORT_LINE is appended. This is used only when no emitted
// dist/index.html is available. Shipped builds recompute the actual hash from final
// emitted HTML and write it into dist/_headers, including path-prefix deployments.
export const INLINE_SCRIPT_SHA256 = "sha256-PMl2r93SrBlv5q3i/zSpRKccCoPdaoyrb/bbIRt7NIY=";

const ATTRIBUTELESS_SCRIPT_RE = /<script\s*>([\s\S]*?)<\/script\s*>/gi;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

// Return the source text of the one real attribute-less inline bootstrap.
// HTML comments are masked at equal UTF-16 length before tag selection so a
// literal <script> token in comment prose cannot become a false opener.
export function inlineBootstrapSourceOf(html) {
  if (typeof html !== 'string') {
    throw new TypeError('inlineBootstrapSourceOf: html must be a string');
  }
  const masked = html.replace(
    HTML_COMMENT_RE,
    (comment) => ' '.repeat(comment.length),
  );
  const matches = [...masked.matchAll(ATTRIBUTELESS_SCRIPT_RE)];
  if (matches.length !== 1) {
    throw new Error(
      `inlineBootstrapSourceOf: expected exactly 1 attribute-less inline script, found ${matches.length}`,
    );
  }
  const match = matches[0];
  const bodyStart = match.index + match[0].indexOf('>') + 1;
  return html.slice(bodyStart, bodyStart + match[1].length);
}

export function inlineBootstrapSha256Of(html) {
  return 'sha256-' + createHash('sha256')
    .update(inlineBootstrapSourceOf(html), 'utf8')
    .digest('base64');
}

// ── connect-src: the federation network policy (ADR-0149) ─────────────────────────
// Stage 1 (v0.2.935, owner-chosen): OPEN — any SECURE server (`https:` + `wss:`), so a
// traveller can reach other nodes' relays, multiplayer sockets and Blossom media. Plain
// `http:`/`ws:` stay blocked. The real defence against injected code stays in
// script-src (hash + 'self' only) and keys stay in the signer (NIP-07), never the page.
// Stage 2 (prepared, NOT active): PREFERRED — the curated list below plus an operator's
// own additions, for nodes that want a closed list. Stage 3 (planned): a SPLIT network
// helper (separate sandboxed origin with open connect-src; the main page goes back to a
// tight list). Review triggers for moving on are in ADR-0149.
export const CONNECT_MODES = Object.freeze({ OPEN: 'open', PREFERRED: 'preferred' });
export const CONNECT_MODE = CONNECT_MODES.OPEN;
// The curated list (ADR-0067 / ADR-0120): every endpoint the game itself dials. Kept in
// lockstep with DEFAULT_NODE_RELAYS (tests/csp-relay-sync.test.js) so stage 2 is ready.
export const PREFERRED_CONNECT_SOURCES = Object.freeze([
  'https://api.github.com',
  'wss://main.relay.gamestr.io', 'wss://relay.routstr.com', 'wss://nos.lol', 'wss://relay.damus.io',
  'wss://relay.primal.net', 'wss://relay.snort.social', 'wss://nostr.mom',
  'wss://relay.staging.plebeian.market', 'wss://relay.plebeian.market',
]);
// An operator addition must be a bare secure origin (no path/query/wildcards/quotes).
const OPERATOR_SOURCE_RE = /^(https|wss):\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
export function isOperatorConnectSource(s) { return typeof s === 'string' && OPERATOR_SOURCE_RE.test(s); }

/** connect-src value for a mode. Throws on an unknown mode (fail closed at build). */
export function connectSrcFor(mode = CONNECT_MODE, { extra = [] } = {}) {
  const base = ["'self'", 'blob:'];
  if (mode === CONNECT_MODES.OPEN) return [...base, 'https:', 'wss:'].join(' ');
  if (mode === CONNECT_MODES.PREFERRED) {
    const add = (Array.isArray(extra) ? extra : []).filter(isOperatorConnectSource);
    return [...new Set([...base, ...PREFERRED_CONNECT_SOURCES, ...add])].join(' ');
  }
  throw new Error(`connectSrcFor: unknown mode ${mode}`);
}

export const CSP_DIRECTIVES = [
  ["object-src", "'none'"],
  ["base-uri", "'self'"],
  ["form-action", "'self'"],
  ["script-src", `'self' 'wasm-unsafe-eval' '${INLINE_SCRIPT_SHA256}'`],
  ["worker-src", "'self' blob:"],
  // v0.2.934 (ADR-0147 M2): the only frame is the same-origin gateway napplet
  // (sandboxed, no network). Nothing else may be framed.
  ["frame-src", "'self'"],
  // v0.2.698-alpha (ADR-0067): the union of every runtime wss:// endpoint the
  // game actually opens a WebSocket to. Adds main.relay.gamestr.io (leaderboard
  // reads/writes — was MISSING before, a latent CSP bug) and the plebeian
  // marketplace relays (marketStall.js uses both staging and prod). Drops
  // relay.nostr.band (down).
  // v0.2.873-alpha (ADR-0120): bring this list back in lockstep with
  // DEFAULT_NODE_RELAYS (A test below/CI asserts every default relay host shows
  // up here). Adds relay.damus.io + relay.primal.net + relay.snort.social +
  // nostr.mom (re-added to the default set by ADR-0076/ADR-0104); DROPS
  // relay.vertexlab.io (DVM-only, removed from the presence path by ADR-0104).
  // The node's OWN relay is wss://$DOMAIN/relay — same origin as the page — and is
  // appended at image build time (Dockerfile) / Caddy (bare-metal) as wss://$DOMAIN,
  // so it is intentionally NOT hardcoded here (the domain is deploy-specific).
  // v0.2.935 (ADR-0149): built by connectSrcFor (stage 1: open, any secure server).
  ["connect-src", connectSrcFor()],
];

export const CSP_VALUE = CSP_DIRECTIVES.map(([k, v]) => `${k} ${v}`).join("; ");

// The exact dynamic-import line the build plugin appends to the trusted inline bootstrap.
// v0.2.791-alpha: the entry is now CONTENT-HASHED (torii-entry-[hash].js) and the old
// `?v=<timestamp>` cache-bust query is gone — the hash in the filename IS the cache-bust
// (a stale cached chunk can only reference an old, now-404 entry file). The real hashed
// filename is filled in by the plugin at build time; this constant is the dev/root-fallback
// representation with a literal `[hash]` token mirroring vite.config.js `entryFileNames`.
// v0.2.773-alpha: keep in lockstep with the vite build injection
// (vite.config.js `entryImportLine`). The `__toriiShellImported` guard
// prevents duplicate entry `import()` calls when a stale SW cache serves an
// older entry alongside the fresh one — protects against the
// duplicate-self / strobing regression the v0.2.773 shell + module guards
// close. Any bit-level change here shifts the sha256 that pins the trusted
// inline bootstrap; INLINE_SCRIPT_SHA256 above MUST be updated in the same
// commit or the CSP will block the bootstrap and the page will be dead.
// v0.2.933 (ADR-0147 M3): resolves from the shell's app root (world links).
export const ENTRY_IMPORT_LINE = "  if (!window.__toriiShellImported) { window.__toriiShellImported = true; import((window.__toriiAppRoot || './') + 'assets/torii-entry-[hash].js'); }";

// Build a CSP value whose script-src carries the GIVEN inline-script sha (used at build
// time so the emitted _headers always matches the actual emitted inline bootstrap).
export function cspValueForSha(inlineSha) {
  const dirs = CSP_DIRECTIVES.map(([k, v]) =>
    k === 'script-src'
      ? [k, `'self' 'wasm-unsafe-eval' '${inlineSha}'`]
      : [k, v],
  );
  return dirs.map(([k, v]) => `${k} ${v}`).join("; ");
}

// Static-host `_headers` file body carrying the CSP for the GIVEN inline-script sha.
export function headersFileBodyForSha(inlineSha) {
  return `# Generated by the vite CSP plugin (tools/csp.mjs) — do not edit by hand.\n/*\n  Content-Security-Policy: ${cspValueForSha(inlineSha)}\n`;
}

// Static-host `_headers` file body (applies the CSP to every path). Legacy fallback
// using the hardcoded INLINE_SCRIPT_SHA256; the build plugin uses headersFileBodyForSha()
// with the sha it recomputes from the emitted inline script.
export function headersFileBody() {
  return headersFileBodyForSha(INLINE_SCRIPT_SHA256);
}

// v0.2.935 (ADR-0149): the same policy as an nginx include, emitted per build as
// dist/csp.nginx.conf. The bootstrap hash changes every build, so an nginx node must
// INCLUDE this file from the installed release (and reload on deploy) rather than
// paste a header by hand. CSP values never contain a double quote or backslash.
export function nginxIncludeBodyForSha(inlineSha) {
  const v = cspValueForSha(inlineSha);
  if (/["\\\n]/.test(v)) throw new Error('nginxIncludeBodyForSha: unsafe CSP value');
  return `# Generated by the vite CSP plugin (tools/csp.mjs) — do not edit by hand.\n# include from the Quest location block; reload nginx after each deploy (ADR-0149).\nadd_header Content-Security-Policy "${v}" always;\n`;
}
