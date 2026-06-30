// tests/entry-flow-smoke.test.js — entry-flow binding contract (v0.2.227; login relocated v0.2.236).
//
// Companion to sw-app-shell.test.js. That suite freezes the SERVICE-WORKER side of the
// v0.2.226 "dead login / ENTER ARENA button" blocker (no stale HTML-shell precache, cache
// version tracks the app, network-first HTML/JS, self-heal reload). THIS suite freezes the
// SOURCE side: that the two title-screen entry buttons actually exist in the shipped
// index.html AND are looked up + click-bound — ENTER in main.js, LOGIN in loginBootstrap.js. A
// silent id rename / typo on EITHER side would unbind a button (it renders but does nothing)
// without failing any other test — exactly the "buttons don't respond" symptom. Pure file reads.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');
const MAIN = readFileSync(join(ROOT, 'src/main.js'), 'utf8');
const HUD  = readFileSync(join(ROOT, 'src/hud.js'), 'utf8');
// v0.2.236: the REAL login handler + readiness flag now live here, imported by main.js BEFORE
// scene.js so login wires even when the WebGL/3D boot throws.
const BOOT = readFileSync(join(ROOT, 'src/engine/ui/loginBootstrap.js'), 'utf8');
const NOSTR = readFileSync(join(ROOT, 'src/nostr.js'), 'utf8');

describe('entry-flow smoke — title-screen buttons exist (regression)', () => {
  for (const { id, label } of [
    { id: 'btn-enter', label: 'ENTER ARENA' },
    { id: 'btn-nostr-centre', label: 'LOGIN WITH NOSTR' },
  ]) {
    it(`index.html declares the ${label} button (id="${id}")`, () => {
      expect(HTML).toContain(`id="${id}"`);
    });
  }

  it('main.js resolves #btn-enter into elEnterBtn and binds a click handler (ENTER ARENA)', () => {
    expect(MAIN).toMatch(/elEnterBtn\s*=\s*document\.getElementById\(\s*['"]btn-enter['"]\s*\)/);
    expect(MAIN).toMatch(/elEnterBtn\??\.addEventListener\(\s*['"]click['"]/);
  });

  it('loginBootstrap.js resolves #btn-nostr-centre and binds a click handler (LOGIN WITH NOSTR)', () => {
    expect(BOOT).toMatch(/getElementById\(\s*\w+\s*\)/); // resolved via a LOGIN_BTN_ID constant
    expect(BOOT).toMatch(/LOGIN_BTN_ID\s*=\s*['"]btn-nostr-centre['"]/);
    expect(BOOT).toMatch(/\.addEventListener\(\s*['"]click['"]/);
  });

  it('the ENTER handler is gated to the title screen (no fire mid-game)', () => {
    expect(MAIN).toMatch(/elEnterBtn\??\.addEventListener\(\s*['"]click['"]/);
    expect(MAIN).toMatch(/if\s*\(\s*!isTitle\(\)\s*\)\s*return/);
  });
});

// v0.2.228: the v0.2.226 SW fix made the buttons reachable, but a cloud/no-extension smoke
// still showed silent no-ops: (a) login feedback was written to #nostr-status, an element that
// never existed in index.html, so it was dropped; (b) the ENTER catch only console.error'd. These
// contracts freeze the "no silent no-op" guarantee: a visible status line exists and is written.
describe('entry-flow no-silent-noop — visible feedback on every click (v0.2.228 regression)', () => {
  it('index.html declares the visible #entry-status feedback line', () => {
    expect(HTML).toMatch(/id="entry-status"/);
  });

  it('the entry buttons route feedback through the real #entry-status element (not dead #nostr-status)', () => {
    expect(MAIN).toMatch(/getElementById\(\s*['"]entry-status['"]\s*\)/);
    expect(BOOT).toMatch(/STATUS_ID\s*=\s*['"]entry-status['"]/);
    // The old null target must be gone on BOTH sides — writing to it was the silent-login bug.
    expect(MAIN).not.toMatch(/getElementById\(\s*['"]nostr-status['"]\s*\)/);
    expect(BOOT).not.toMatch(/getElementById\(\s*['"]nostr-status['"]\s*\)/);
  });

  it('the ENTER catch surfaces a user-facing message AND re-enables the button (no silent reset)', () => {
    const block = MAIN.slice(
      MAIN.indexOf("elEnterBtn?.addEventListener('click'"),
      MAIN.indexOf('window.__toriiEnterReady'),
    );
    expect(block).toMatch(/catch\s*\(/);
    expect(block).toMatch(/showEntryStatus\(/);
    expect(block).toMatch(/elEnterBtn\.disabled\s*=\s*false/);
  });

  it('the LOGIN handler shows its result on the visible status line', () => {
    expect(BOOT).toMatch(/showStatus\(\s*statusEl\s*,\s*result\s*\)/);
  });
});

// v0.2.229: immediate ENTER feedback before awaiting bootstrap; clean a11y tree on title; a THROWN
// nostrLogin() still surfaces a message instead of a stuck "Connecting…".
describe('entry-flow visibility — immediate feedback + clean a11y tree (v0.2.229 regression)', () => {
  it('the ENTER click shows an IMMEDIATE visible status (not a clear) before awaiting bootstrap', () => {
    const block = MAIN.slice(
      MAIN.indexOf("elEnterBtn?.addEventListener('click'"),
      MAIN.indexOf('window.__toriiEnterReady'),
    );
    const beforeTry = block.slice(0, block.indexOf('try {'));
    expect(beforeTry).toMatch(/showEntryStatus\(\s*['"][^'"]+['"]\s*\)/);
  });

  it('#death-msg is aria-hidden by default in index.html (no YOU DIED on the title a11y tree)', () => {
    expect(HTML).toMatch(/id="death-msg"[^>]*aria-hidden="true"/);
  });

  it('hud.js toggles aria-hidden in lockstep with the .show class', () => {
    const block = HUD.slice(HUD.indexOf('PLAYER_KILLED'), HUD.indexOf('}', HUD.indexOf('PLAYER_RESPAWN')));
    expect(block).toMatch(/classList\.add\(\s*['"]show['"]\s*\)[\s\S]*setAttribute\(\s*['"]aria-hidden['"]\s*,\s*['"]false['"]\s*\)/);
    expect(block).toMatch(/classList\.remove\(\s*['"]show['"]\s*\)[\s\S]*setAttribute\(\s*['"]aria-hidden['"]\s*,\s*['"]true['"]\s*\)/);
  });

  it('the LOGIN handler guards the nostrLogin await so a throw still surfaces a message', () => {
    const block = BOOT.slice(BOOT.indexOf('async function doNostrLogin'));
    expect(block).toMatch(/try\s*\{/);
    expect(block).toMatch(/catch\s*\(/);
    const catchPart = block.slice(block.indexOf('catch'));
    expect(catchPart).toMatch(/showStatus\(/);
  });
});

// v0.2.230: bundle-INDEPENDENT inline bootstrap in index.html wires both buttons regardless of the
// module, plus the readiness flags the module sets so the inline path stands down. Frozen here.
describe('entry-flow runtime proof — inline bundle-independent bootstrap (v0.2.230 regression)', () => {
  function inlineScript() {
    const re = /<script>([\s\S]*?)<\/script>/g;
    let m, last = null;
    while ((m = re.exec(HTML)) !== null) last = m[1];
    return last || '';
  }

  it('the inline script binds a click handler to BOTH entry buttons (works even if the bundle is dead)', () => {
    const s = inlineScript();
    expect(s).toMatch(/getElementById\(\s*['"]btn-enter['"]\s*\)/);
    expect(s).toMatch(/getElementById\(\s*['"]btn-nostr-centre['"]\s*\)/);
    expect((s.match(/addEventListener\(\s*['"]click['"]/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('the inline LOGIN fallback surfaces the no-provider case visibly (no window.nostr)', () => {
    const s = inlineScript();
    expect(s).toMatch(/window\.nostr/);
    expect(s).toMatch(/NIP-07 extension not found/);
  });

  it('the inline handlers stand down once the module sets its readiness flags (no double-handling)', () => {
    const s = inlineScript();
    expect(s).toMatch(/window\.__toriiEnterReady/);
    expect(s).toMatch(/window\.__toriiLoginReady/);
  });

  it('main.js sets the ENTER readiness flag AFTER binding the real handler', () => {
    expect(MAIN).toMatch(/window\.__toriiEnterReady\s*=\s*true/);
    const enterBind = MAIN.indexOf("elEnterBtn?.addEventListener('click'");
    const enterFlag = MAIN.indexOf('window.__toriiEnterReady = true');
    expect(enterBind).toBeGreaterThanOrEqual(0);
    expect(enterFlag).toBeGreaterThan(enterBind);
  });

  it('loginBootstrap.js raises the LOGIN readiness flag after binding the real handler', () => {
    expect(BOOT).toMatch(/window\.__toriiLoginReady\s*=\s*true/);
    const loginBind = BOOT.indexOf(".addEventListener('click'");
    const loginFlag = BOOT.indexOf('window.__toriiLoginReady = true');
    expect(loginBind).toBeGreaterThanOrEqual(0);
    expect(loginFlag).toBeGreaterThan(loginBind);
  });

  it('the inline bootstrap uses textContent, never innerHTML (no injection surface)', () => {
    const s = inlineScript();
    expect(s).toMatch(/textContent/);
    expect(s).not.toMatch(/innerHTML/);
  });
});

// v0.2.236: the live blocker that survived v0.2.228/229/230 — clicking LOGIN WITH NOSTR on the live
// site still showed "Login still loading - reload the page if this persists." The real handler +
// __toriiLoginReady lived at the END of main.js, AFTER `import { renderer } from './scene.js'`
// (scene.js builds a WebGLRenderer at import time) and after the throw-prone buildArena()/… boot. A
// WebGL/boot throw aborted main.js before login was ever wired, so the inline fallback never stood
// down — even though login needs no 3D. The fix moves login into loginBootstrap.js (no THREE/scene
// deps), imported BEFORE scene.js and self-installing on import, so a LOADED bundle always wires
// login regardless of the 3D boot. These contracts freeze that decoupling.
describe('login decoupled from the 3D boot — loaded bundle never stuck in fallback (v0.2.236)', () => {
  it('main.js wires loginBootstrap.js and NEVER statically imports ./scene.js (renderer deferred behind ENTER — v0.2.264 R2)', () => {
    const bootImport = MAIN.indexOf("'./engine/ui/loginBootstrap.js'");
    expect(bootImport).toBeGreaterThanOrEqual(0);
    // R2: the WebGL renderer (scene.js) now lives in arenaRuntime.js, dynamically
    // imported ONLY inside the ENTER handler. The shell must not statically import
    // it — login (and the whole title screen) wires with zero three on first paint.
    expect(MAIN).not.toMatch(/from\s+['"]\.\/scene\.js['"]/);
    // The renderer is reachable only via the deferred arenaRuntime import.
    expect(MAIN).toMatch(/import\(\s*['"]\.\/arenaRuntime\.js['"]\s*\)/);
  });

  it('loginBootstrap.js has NO THREE / scene / WebGL dependency (a 3D throw cannot kill login)', () => {
    // It may only import the light nostr.js (→ state/events). Any three/scene import would re-couple
    // login to the very renderer construction that was aborting the module. Scan REAL import
    // statements only (lines beginning with `import`), never comment prose that quotes an import.
    const imports = BOOT.split('\n')
      .filter((l) => /^\s*import\b/.test(l))
      .map((l) => (l.match(/from\s+['"]([^'"]+)['"]/) || [])[1])
      .filter(Boolean);
    for (const spec of imports) {
      expect(spec).not.toMatch(/three/i);
      expect(spec).not.toMatch(/scene/i);
    }
    // The login path's only module dependency is the dependency-light nostr login.
    expect(imports.some((s) => /nostr/i.test(s))).toBe(true);
  });

  it('loginBootstrap.js self-installs on import (top-level), independent of any main.js call', () => {
    // A browser-guarded top-level install so login binds at module-eval time, before scene.js evals.
    expect(BOOT).toMatch(/typeof document !== 'undefined'\s*\)\s*installLoginBootstrap\(\)/);
  });

  it('the old login block is fully removed from main.js (no stale duplicate handler/flag)', () => {
    expect(MAIN).not.toMatch(/_doNostrLogin/);
    // Login wiring lives in loginBootstrap.js — main.js must not import/call the
    // login function itself. (main.js MAY import non-login nostr.js exports —
    // e.g. the relay transport it injects into the pure worldPresence layer —
    // since that is dependency injection at the composition root, not login logic.)
    expect(MAIN).not.toMatch(/\bnostrLogin\b/);
    // The login readiness flag is ASSIGNED only by loginBootstrap.js now (a comment may still
    // reference it); main.js must not re-raise it.
    expect(MAIN).not.toMatch(/window\.__toriiLoginReady\s*=/);
  });

  it('nostr.js gives a SPECIFIC no-provider message and an ACTIONABLE error (not "still loading")', () => {
    expect(NOSTR).toMatch(/NIP-07 extension not found/);
    // Provider-exists-but-errors path must be actionable, never a dead-end "Login failed".
    const errMatch = NOSTR.match(/return\s+'Login failed[^']*'/);
    expect(errMatch).toBeTruthy();
    expect(errMatch[0]).toMatch(/try again|extension/i);
    expect(NOSTR).not.toMatch(/still loading/i);
  });
});
