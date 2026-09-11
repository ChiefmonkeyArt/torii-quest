import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, basename } from 'node:path';
import { defineConfig } from 'vite';
import {
  CSP_VALUE,
  headersFileBody,
  headersFileBodyForSha,
  cspValueForSha,
  inlineBootstrapSha256Of,
} from './tools/csp.mjs';
import { buildReleaseMeta, validateReleaseMeta } from './tools/releaseMeta.mjs';

// CSP via HTTP header (S3, v0.2.266). The policy lives in tools/csp.mjs (single source).
// This plugin: (1) rewrites the BUILT index.html so the trusted classic inline bootstrap
// script `import()`s the CONTENT-HASHED entry (assets/torii-entry-<hash>.js) instead of a
// static <script> tag — keeping one hash-authorized inline loader while script-src `'self'`
// authorizes the same-origin ESM graph; (2) writes dist/_headers for the static host;
// (3) serves the same header from `vite preview`.
//
// v0.2.791-alpha (ADR-0109): the entry is now content-hashed (torii-entry-[hash].js)
// and the per-build `?v=<timestamp>` cache-bust query is REMOVED. The previous scheme
// pinned the entry to a STABLE filename (`torii-entry.js`) and distinguished builds only
// by a timestamp query string. That is fragile: a stale cached chunk could still resolve
// a valid (current) entry file under an old `?v=<stamp>` URL, re-evaluate `torii-entry.js`
// a second time, and trip the duplicate-boot guard ("Stale build detected") in a loop that
// survives cache-clear + service-worker-unregister. With a content hash in the filename,
// a stale chunk references an old entry file that no longer exists (404), so stale and
// fresh builds can never be confused at the module-URL level and the double-boot guard
// can never fire. The bundler emits every chunk's back-reference as the relative
// `./torii-entry-<hash>.js` automatically, so the old write-time back-reference rewrite is
// gone too.

// Locate the content-hashed entry chunk's emitted filename (e.g.
// 'assets/torii-entry-AbCdEf.js') from the build output bundle.
function hashedEntryFileName(bundle) {
  for (const value of Object.values(bundle)) {
    if (value && value.type === 'chunk' && value.isEntry) return value.fileName;
  }
  return null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// v0.2.370-alpha → preview-basepath fix (kept, now hash-based): the entry URL is RELATIVE
// so the bundle loads at root `/`, the Suite `/quest/` mount, AND any arbitrary preview
// sub-path (unknown at build time). The content hash — not a query string — is the
// cache-bust, so relative specifiers are both immutable and base-agnostic.
//
//   entryUrl (HTML)       → './assets/torii-entry-<hash>.js' (relative to index.html
//                           at the deploy root, where /assets/ is a sibling dir).
//   chunk back-reference   → './torii-entry-<hash>.js' (emitted by the bundler relative
//                           to a chunk living in /assets/, where the entry is a peer).
//
// Why this works for ALL deploy contexts:
//   root `/`            → ./assets/...  resolves to /assets/...        ✓
//   `/quest/`           → ./assets/...  resolves to /quest/assets/... ✓
//   `/computer/a/.../`  → ./assets/...  resolves to /computer/a/.../assets/... ✓
// (and likewise ./torii-entry-<hash>.js from a chunk in <base>/assets/).

// Bootstrap selection and hashing are shared with check 16 and the emitted-build
// tests so HTML-comment decoys cannot make the policy hash different source bytes.
function cspHeaderPlugin() {
  return {
    name: 'torii-csp-http-header',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        // Only the built HTML (ctx.bundle present); the dev server keeps the
        // static module tag (no CSP header in dev — strict-dynamic would block
        // Vite's own injected client/HMR scripts).
        if (!ctx.bundle) return html;
        const entryFileName = hashedEntryFileName(ctx.bundle);
        if (!entryFileName) return html;
        // Resolve the hashed entry against the document (deploy root) — base-agnostic so
        // root `/`, `/quest/`, and any preview sub-path all resolve the same file.
        const entryUrl = './' + entryFileName;
        const entryBaseRe = escapeRegExp(basename(entryFileName));
        // Drop the bundler-emitted static entry tag + any modulepreload hint for it; the
        // trusted inline bootstrap remains the single entry-loader path.
        // Base-agnostic: matches `/assets/…` and base-prefixed `/quest/assets/…`.
        let out = html
          .replace(new RegExp('\\s*<script\\b[^>]*\\bsrc="[^"]*\\/assets\\/' + entryBaseRe + '"[^>]*><\\/script>'), '')
          .replace(new RegExp('<link\\b[^>]*\\bhref="[^"]*\\/assets\\/' + entryBaseRe + '"[^>]*>', 'g'), '');
        // Append the hashed entry import to the LAST inline bootstrap <script>. The
        // content hash in the filename is the cache-bust (a stale cached chunk can only
        // point at an old, now-404 entry file — never re-evaluate the fresh entry).
        // v0.2.360-alpha regression fix: previously matched `\n</script>\n</body>`
        // verbatim, which silently no-op'd when DOM elements landed between the script
        // and </body>. This lastIndexOf-based append is decoupled from that layout.
        const lastCloseIdx = out.lastIndexOf('</script>');
        if (lastCloseIdx === -1) {
          throw new Error('torii-csp-http-header: no </script> found in built HTML — refusing to emit a bootstrap-less bundle');
        }
        // v0.2.773-alpha: idempotent import guard (belt + braces with the module guard
        // in src/main.js). With content-hashing this can no longer be tripped by a stale
        // entry, but the guard remains so at most one entry import ever fires per document.
        const entryImportLine =
          `  if (!window.__toriiShellImported) { window.__toriiShellImported = true; import('${entryUrl}'); }`;
        out = out.slice(0, lastCloseIdx) + `\n${entryImportLine}\n` + out.slice(lastCloseIdx);
        return out;
      },
    },
    writeBundle(options) {
      const dir = options.dir || join(process.cwd(), 'dist');
      // v0.2.791-alpha: no more back-reference rewrite — the bundler already emits every
      // chunk's import of the entry as the relative `./torii-entry-<hash>.js` (verified in
      // tests/quest-base-entry.test.js). Recompute the inline-bootstrap sha from the EMITTED
      // dist/index.html (which now carries the hashed import line) and write _headers with
      // the matching policy.
      const htmlPath = join(dir, 'index.html');
      let body = headersFileBody(); // fallback to the hardcoded sha
      if (existsSync(htmlPath)) {
        const sha = inlineBootstrapSha256Of(readFileSync(htmlPath, 'utf8'));
        if (sha) body = headersFileBodyForSha(sha);
      }
      writeFileSync(join(dir, '_headers'), body);

      // v0.2.604: stamp a FRESH dist/release-metadata.json from the live version +
      // git commit + build timestamp on every build. The committed
      // public/release-metadata.json stays a deterministic template (never churns
      // the working tree); only the DEPLOYED dist copy carries provenance. Fixes
      // the stale-metadata bug where the deployed file was stuck at v0.2.232 with
      // generatedAt:null + commit:null, which made torii-deploy falsely warn "not
      // found on live site" + the in-app version panel read stale data. Safe:
      // best-effort commit (null when git is unavailable); the metadata is
      // descriptive-only (update.autoUpdate stays false).
      try {
        const cfgSrc = readFileSync(join(process.cwd(), 'src/config.js'), 'utf8');
        const vMatch = cfgSrc.match(/VERSION\s*=\s*['"]([^'"]+)['"]/);
        const version = vMatch ? vMatch[1] : null;
        let commit = null;
        try {
          commit = execSync('git rev-parse --short HEAD', { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
        } catch { /* git unavailable — null commit */ }
        const meta = buildReleaseMeta({
          version,
          commit,
          generatedAt: new Date().toISOString(),
        });
        writeFileSync(join(dir, 'release-metadata.json'), JSON.stringify(meta, null, 2) + '\n');
        const { ok, errors } = validateReleaseMeta(meta);
        if (!ok) console.warn(`[torii-release-meta] wrote INVALID metadata: ${errors.join('; ')}`);
      } catch (e) {
        // Non-fatal: a missing config.js or a read error must never fail the build.
        console.warn(`[torii-release-meta] skipped (non-fatal): ${e?.message || e}`);
      }
    },
    configurePreviewServer(server) {
      // Serve the CSP that matches the built dist inline script if one exists; otherwise
      // fall back to the hardcoded sha (pre-build preview of the source shell).
      const distHtmlPath = join(process.cwd(), 'dist', 'index.html');
      let csp = CSP_VALUE;
      if (existsSync(distHtmlPath)) {
        const sha = inlineBootstrapSha256Of(readFileSync(distHtmlPath, 'utf8'));
        if (sha) csp = cspValueForSha(sha);
      }
      server.middlewares.use((_req, res, next) => {
        res.setHeader('Content-Security-Policy', csp);
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [cspHeaderPlugin()],
  server: { port: 5174 },
  build: {
    outDir: 'dist',
    // Rapier (2.2M) is an intentional LAZY chunk (dynamic import on Enter
    // Arena) and never blocks initial paint, so 700K is the right bar for the
    // UPFRONT chunks (three-vendor + game logic); the lazy physics giant is
    // expected and does not trip a real-size warning.
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        // v0.2.791-alpha: content-hash the entry so a stale cached chunk can only point
        // at an old, now-404 entry file — it can never re-evaluate the fresh entry and
        // trip the duplicate-boot guard. The inline bootstrap's import target (and thus
        // its CSP sha256) is recomputed at build time, so per-build churn is expected and
        // handled (see writeBundle).
        entryFileNames: 'assets/torii-entry-[hash].js',
        manualChunks(id) {
          // All three.js core + addons in one vendor chunk. (Addons can't be
          // deferred separately yet: the arena modules that import them are
          // statically imported at startup. Deferring them is a future
          // arena-bundle lazy-load behind Enter Arena — a game-loop refactor.)
          if (id.includes('/three/')) return 'three-vendor';
        }
      }
    }
  },
  // Silence Rolldown codeSplitting suggestion — we're handling it manually
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'] // don't pre-bundle Rapier — it's lazy
  },
  // Vitest config (v0.2.120, perf tuning v0.2.260). Node environment — the unit
  // suite covers pure logic seams (state machine, event bus, headshot classifier)
  // only, so no jsdom/Three/Rapier/browser is needed. `npm test` runs `vitest run`.
  //
  // pool: 'threads' + isolate: false — the suite is 108 files / 1834 tests but
  // every test imports only PURE helpers (no THREE, no Rapier, no DOM, no module-
  // scope mutation). Per-file isolation was costing ~26 s of collect/prepare overhead
  // for ~1.5 s of actual test execution. Sharing the worker module graph drops the
  // full suite from ~28.7 s to ~2.7 s with all 1834 tests still green. If a future
  // test ever needs a fresh module graph (rare for pure-logic seams), move it to a
  // dedicated vitest project with isolate:true rather than reverting this default.
  test: {
    environment: 'node',
    // Colocated engine tests (src/engine/**) were previously excluded from
    // vitest discovery, so real-fetch regressions (worldLoader) never ran in CI.
    // Both trees are pure node-safe (THREE math only, no DOM) — see F8.
    include: ['tests/**/*.test.js', 'src/engine/**/*.test.js'],
    pool: 'threads',
    poolOptions: { threads: { isolate: false, singleThread: false } },
  },
});
