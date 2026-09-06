// tests/v0.2.777-regression.test.js — SW cache-busting hardening (Bug K).
//
// Bug K (user report, twice): after a redeploy, a returning player's buttons
// would arm (turn green on card-pick / login) but clicking ENTER did nothing —
// until a manual hard-refresh with ?nuked=1 fixed it. Root cause: a stale
// service-worker cache spacing implicit. The existing self-heals were either
//   (a) reactive — the ENTER-ARENA dupe-boot guard (v0.2.775) only fires when
//       the lazy arenaRuntime chunk re-invokes main.js, and
//   (b) the controllerchange auto-reload was gated on window.__toriiEnterReady,
//       which is set as soon as main.js WIRES the buttons — not when the game
//       actually enters. So the exact "green-but-dead" state (wired yet stranded)
//       suppressed the very reload that would have healed it.
//
// This suite freezes the hardening as a contract (pure file reads, matching the
// established source-level regression pattern):
//   1. sw.js exposes its CACHE_VERSION (bare semantic version) via a
//      TORII_SW_PING→TORII_SW_VERSION message round-trip, and broadcasts on
//      activate.
//   2. index.html embeds window.__TORII_APP_VERSION and self-heals on version
//      mismatch without waiting for controllerchange.
//   3. The shared toriiSelfHealStaleShell() is idempotent (__toriiNuking) and
//      used by BOTH the double-boot fingerprint and the version-mismatch check.
//   4. The controllerchange reload gate keys on window.__toriiEntered (actual
//      arena entry), NOT __toriiEnterReady (mere wiring).
//   5. main.js sets window.__toriiEntered once, after _arena.enter().
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');
const SW = readFileSync(join(ROOT, 'public/sw.js'), 'utf8');
const MAIN = readFileSync(join(ROOT, 'src/main.js'), 'utf8');

describe('v0.2.777 — Bug K: SW exposes its version for proactive stale-SW detection', () => {
  it('derives a bare SW_APP_VERSION from CACHE_VERSION (strips the tq- prefix)', () => {
    expect(SW).toMatch(/CACHE_VERSION\s*=\s*'tq-v[0-9.]+-alpha'/);
    // The bare version the shell compares against window.__TORII_APP_VERSION
    // must be the CACHE_VERSION minus its 'tq-' cache-namespace prefix.
    expect(SW).toMatch(/SW_APP_VERSION\s*=\s*CACHE_VERSION\.replace\(\/\^tq-\/\s*,\s*''\)/);
  });

  it('answers TORII_SW_PING with TORII_SW_VERSION carrying the bare version', () => {
    expect(SW).toMatch(/addEventListener\(\s*['"]message['"]/);
    // The inbound wake-up is an equality check on the received event payload.
    expect(SW).toMatch(/data\.type\s*===\s*['"]TORII_SW_PING['"]/);
    expect(SW).toMatch(/type\s*:\s*['"]TORII_SW_VERSION['"]/);
    // The reply must carry SW_APP_VERSION, not the raw prefixed CACHE_VERSION.
    const reply = SW.match(/TORII_SW_VERSION['"]\s*,\s*version:\s*([A-Za-z_0-9]+)/);
    expect(reply).not.toBeNull();
    expect(reply[1]).toBe('SW_APP_VERSION');
  });

  it('broadcasts its version on activate (so already-controlled pages settle)', () => {
    // _broadcastVersion is defined and invoked from the activate settle hook.
    expect(SW).toMatch(/function _broadcastVersion\(\)/);
    expect(SW).toMatch(/self\.clients\.claim\(\);\s*_broadcastVersion\(\)/);
    expect(SW).toMatch(/self\.clients\.matchAll\(\{\s*type:\s*['"]window['"]/);
  });
});

describe('v0.2.777 — Bug K: shell embeds + compares its expected version', () => {
  it('embeds window.__TORII_APP_VERSION matching config VERSION literal', () => {
    expect(HTML).toMatch(/window\.__TORII_APP_VERSION\s*=\s*'v0\.2\.[0-9]+-alpha'/);
  });

  it('self-heals on a reported SW version mismatch (no controllerchange wait)', () => {
    const s = HTML;
    expect(s).toMatch(/addEventListener\(\s*['"]message['"]/);
    expect(s).toMatch(/d\.type\s*!==\s*['"]TORII_SW_VERSION['"]/);
    expect(s).toMatch(/d\.version\s*!==\s*window\.__TORII_APP_VERSION/);
    // The mismatch branch must call the shared self-heal, not reload inline.
    expect(s).toMatch(/toriiSelfHealStaleShell\(\)/);
  });

  it('pings the current controller for its version', () => {
    expect(HTML).toMatch(/postMessage\(\{\s*type:\s*['"]TORII_SW_PING['"]\s*\}\)/);
    expect(HTML).toMatch(/navigator\.serviceWorker\.controller/);
  });

  it('shares ONE toriiSelfHealStaleShell() used by both heal triggers', () => {
    // The double-boot branch and the version-mismatch branch must both delegate
    // to the single idempotent heal — published as 'function toriiSelfHealStaleShell()'.
    expect(HTML).toMatch(/function toriiSelfHealStaleShell\(\)/);
    // Idempotency: __toriiNuking flag + ?nuked=1 URL pin.
    expect(HTML).toMatch(/if\s*\(\s*window\.__toriiNuking\s*\)\s*return/);
    expect(HTML).toMatch(/\[\?&\]nuked=1\(\?:&\|\$\)/);
    // The double-boot fingerprint now routes through the shared heal.
    expect(HTML).toMatch(/if\s*\(\s*window\.__toriiShellRan\s*\)\s*\{[\s\S]*?toriiSelfHealStaleShell\(\)/);
  });
});

describe('v0.2.777 — Bug K: controllerchange auto-reload keys on actual entry', () => {
  it('gates the reload on window.__toriiEntered, not __toriiEnterReady', () => {
    const s = HTML;
    // The reload is suppressed only once the game ACTUALLY entered.
    expect(s).toMatch(/if\s*\(\s*window\.__toriiEntered\s*\)\s*return/);
    // The inert-wiring flag must NOT be what suppresses it.
    const gateBlock = s.slice(s.indexOf('controllerchange'), s.indexOf('navigator.serviceWorker.register'));
    expect(gateBlock).not.toMatch(/if\s*\(\s*window\.__toriiEnterReady\s*\)\s*return/);
  });

  it('main.js raises __toriiEntered only after _arena.enter() succeeds', () => {
    const enterIdx = MAIN.indexOf('_arena.enter()');
    const enteredIdx = MAIN.indexOf('window.__toriiEntered = true');
    expect(enterIdx).toBeGreaterThan(-1);
    expect(enteredIdx).toBeGreaterThan(enterIdx);
  });

  it('keeps the legacy __toriiEnterReady flag for the inline fallback (unchanged)', () => {
    // The inline click-fallback still uses __toriiEnterReady to decide whether
    // the real bundle handler is bound. Only the RELOAD gate changed semantics.
    expect(HTML).toMatch(/if\s*\(\s*window\.__toriiEnterReady\s*\)\s*return/);
  });
});