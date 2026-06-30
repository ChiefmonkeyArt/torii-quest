import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { defineConfig } from 'vite';
import { CSP_VALUE, headersFileBody, headersFileBodyForSha, cspValueForSha } from './tools/csp.mjs';

// CSP via HTTP header (S3, v0.2.266). The policy lives in tools/csp.mjs (single source).
// This plugin: (1) rewrites the BUILT index.html so the trusted classic inline bootstrap
// script `import()`s the pinned entry (assets/torii-entry.js) instead of a static
// <script> tag — letting `strict-dynamic` cover the whole module graph; (2) writes
// dist/_headers for the static host; (3) serves the same header from `vite preview`.
//
// v0.2.281: the entry import now carries a per-build cache-bust query (?v=<stamp>) so
// Cloudflare's 4h edge cache can never serve a stale entry that points at a dead/old
// chunk hash after a publish. Because that changes the inline-script text, the CSP sha is
// recomputed from the EMITTED inline script at writeBundle time and written into
// dist/_headers — so the policy always matches the shipped bootstrap.
const BUILD_STAMP = Date.now().toString(36);
const VERSIONED_IMPORT_LINE = `  import('/assets/torii-entry.js?v=${BUILD_STAMP}');`;

// Recompute the sha256 of the single attribute-less inline <script> in dist/index.html.
// Must match the extraction regex used by tools/regression-check.mjs (check 16c).
function inlineScriptShaOf(html) {
  const matches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (!matches.length) return null;
  return 'sha256-' + createHash('sha256').update(matches[0], 'utf8').digest('base64');
}
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
        // Drop the parser-inserted entry tag + any modulepreload hint for it; the
        // trusted inline bootstrap loads it via import() so strict-dynamic applies.
        let out = html
          .replace(/\s*<script\b[^>]*\bsrc="\/assets\/torii-entry\.js"[^>]*><\/script>/, '')
          .replace(/\s*<link\b[^>]*\bhref="\/assets\/torii-entry\.js"[^>]*>/g, '');
        // Append the versioned entry import to the single classic inline bootstrap
        // script. The ?v=<stamp> query busts the 4h CDN edge cache on every publish so a
        // stale entry (pointing at a dead chunk hash) can never reach a returning player.
        out = out.replace(/\n<\/script>\n<\/body>/, `\n${VERSIONED_IMPORT_LINE}\n</script>\n</body>`);
        return out;
      },
    },
    writeBundle(options) {
      const dir = options.dir || join(process.cwd(), 'dist');
      // Recompute the inline-bootstrap sha from the EMITTED dist/index.html (which now
      // carries the versioned import line) and write _headers with the matching policy.
      const htmlPath = join(dir, 'index.html');
      let body = headersFileBody(); // fallback to the hardcoded sha
      if (existsSync(htmlPath)) {
        const sha = inlineScriptShaOf(readFileSync(htmlPath, 'utf8'));
        if (sha) body = headersFileBodyForSha(sha);
      }
      writeFileSync(join(dir, '_headers'), body);
    },
    configurePreviewServer(server) {
      // Serve the CSP that matches the built dist inline script if one exists; otherwise
      // fall back to the hardcoded sha (pre-build preview of the source shell).
      const distHtmlPath = join(process.cwd(), 'dist', 'index.html');
      let csp = CSP_VALUE;
      if (existsSync(distHtmlPath)) {
        const sha = inlineScriptShaOf(readFileSync(distHtmlPath, 'utf8'));
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
        // Pin the entry chunk to a stable filename so the inline bootstrap's
        // import() target (and therefore its sha256 in the CSP) never churns.
        entryFileNames: 'assets/torii-entry.js',
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
    include: ['tests/**/*.test.js'],
    pool: 'threads',
    poolOptions: { threads: { isolate: false, singleThread: false } },
  },
});
