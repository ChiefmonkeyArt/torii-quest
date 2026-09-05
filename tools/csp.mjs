import { createHash } from 'node:crypto';

// tools/csp.mjs — single source of truth for the Content-Security-Policy (S3, v0.2.266).
//
// The CSP ships as an HTTP RESPONSE HEADER, never a <meta> tag. It is emitted in three
// places, all derived from CSP_VALUE here so they cannot drift:
//   1. dist/_headers  — written at build by the vite plugin; honoured by the static host
//      (S3 / torii-quest.pplx.app, Netlify/Cloudflare-style `_headers`).
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
export const INLINE_SCRIPT_SHA256 = "sha256-fCDPzlKOJl31vTvhwUpgNRm1dl3xLTvgr7sRe0vDcQg=";

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

export const CSP_DIRECTIVES = [
  ["object-src", "'none'"],
  ["base-uri", "'self'"],
  ["form-action", "'self'"],
  ["script-src", `'self' 'wasm-unsafe-eval' '${INLINE_SCRIPT_SHA256}'`],
  ["worker-src", "'self' blob:"],
  // v0.2.698-alpha (ADR-0067): the union of every runtime wss:// endpoint the
  // game actually opens a WebSocket to. Adds main.relay.gamestr.io (leaderboard
  // reads/writes — was MISSING before, a latent CSP bug) and the plebeian
  // marketplace relays (marketStall.js uses both staging and prod). Drops
  // relay.nostr.band (down) and relay.primal.net (rejects #game tag, not used).
  ["connect-src", "'self' blob: https://api.github.com wss://main.relay.gamestr.io wss://relay.routstr.com wss://nos.lol wss://relay.vertexlab.io wss://relay.staging.plebeian.market wss://relay.plebeian.market"],
];

export const CSP_VALUE = CSP_DIRECTIVES.map(([k, v]) => `${k} ${v}`).join("; ");

// The exact dynamic-import line the build plugin appends to the trusted inline bootstrap.
// v0.2.285: a per-build cache-bust query is appended so Cloudflare's edge cache (4h)
// can never serve a stale entry that points at a dead/old chunk hash after a publish.
// The query is filled in by the plugin at build time; this constant is the dev fallback.
export const ENTRY_IMPORT_LINE = "  import('/assets/torii-entry.js');";

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
