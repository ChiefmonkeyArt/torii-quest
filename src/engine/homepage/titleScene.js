// engine/homepage/titleScene.js — mounts the 3D landing scene BEHIND the title
// screen (#screen-title) content, so the HOME SCREEN itself is 3D.
//
// ONE scene instance, reused across TITLE-phase visits: mounted while
// phase === TITLE, unmounted the moment the player leaves (ENTER ARENA / NAP
// zone / etc.) so the arena owns the only live GL context + no rAF runs behind a
// hidden title. Reuses homepageScene.mountHomepageScene (lazy three import,
// fail-safe, full dispose on unmount).
//
// The gateway-setup stub (homepageStub.js) opens as a glassy modal OVER this —
// it no longer mounts its own scene (that would paint a dark canvas over the
// title 3D); its semi-transparent backdrop now shows this scene blurred behind.
//
// Pure-ish: no fetch/sign/relay/navigation. Display + rAF only, with a WebGL
// pre-import gate so three is never requested in headless/jsdom tests.

let _host = null;       // the scene-host div inside #screen-title
let _scene = null;      // { unmount } | null — the live scene handle
let _mounting = false;  // guard against concurrent mount attempts

function _doc() {
  try { return (typeof document !== 'undefined') ? document : null; } catch { return null; }
}

// _hasWebGL() → true only if a throwaway canvas can acquire a WebGL context.
// Cheap pre-import gate so the three chunk is never requested in headless/jsdom
// envs + no pending async import leaks across cases. Never throws.
function _hasWebGL() {
  try {
    const doc = _doc();
    if (!doc || typeof doc.createElement !== 'function') return false;
    const c = doc.createElement('canvas');
    return !!(c.getContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

// installTitleScene(titleEl) — creates a full-bleed scene-host as the FIRST
// child of #screen-title (so all title content paints above it) + makes the
// title background transparent so the 3D shows through. Idempotent. No-op in a
// missing-document (node/test) context.
export function installTitleScene(titleEl) {
  const doc = _doc();
  if (!doc || !titleEl || typeof titleEl.prepend !== 'function') return;
  if (_host) return; // already installed
  const host = doc.createElement('div');
  host.id = 'torii-title-scene';
  Object.assign(host.style, {
    position: 'absolute', inset: '0', zIndex: '-1',
    overflow: 'hidden', pointerEvents: 'none',
  });
  titleEl.prepend(host);
  _host = host;
  // Let the 3D show through the title screen. zIndex:-1 paints the canvas below
  // #screen-title's static content (logo / ENTER buttons / side cards), so the
  // gate + starfield sit BEHIND the UI, not in front of it. The body behind
  // #screen-title supplies the dark base; the scene paints on top of it.
  titleEl.style.background = 'transparent';
}

// mountTitleScene() — lazily import + mount the 3D scene into the title
// scene-host. Non-blocking + fail-safe: the import + WebGL probe are async, so
// the title content is usable immediately. If three/WebGL is unavailable the
// scene never mounts + the title screen keeps its (now transparent) background
// over the body's dark base. Never throws into the loop.
export async function mountTitleScene() {
  if (_mounting) return;
  if (!_host) return;
  _mounting = true;
  try {
    if (_scene) { try { _scene.unmount(); } catch { /* best-effort */ } _scene = null; }
    if (!_hasWebGL()) return;
    const mod = await import('./homepageScene.js');
    const handle = await mod.mountHomepageScene(_host);
    _scene = handle;
  } catch {
    /* no three / no WebGL / import failed — title screen stays on the body bg */
  } finally {
    _mounting = false;
  }
}

// unmountTitleScene() — tear the scene down (cancels rAF, disposes GL + geos).
// Called on every phase change AWAY from TITLE. Safe to call when nothing is
// mounted.
export function unmountTitleScene() {
  if (_scene) { try { _scene.unmount(); } catch { /* best-effort */ } _scene = null; }
}

// _resetForTest() — TEST ONLY. Clears module state so no handle leaks across
// vitest cases (isolate:false shares the module graph).
export function _resetForTest() { _host = null; _scene = null; _mounting = false; }
