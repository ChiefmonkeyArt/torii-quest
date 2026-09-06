// loginBootstrap.js — the REAL "LOGIN WITH NOSTR" wiring, deliberately split out of main.js so it
// can be installed BEFORE the heavy 3D boot (v0.2.236).
//
// THE BUG THIS FIXES: until v0.2.235 the real login handler and its readiness flag
// (window.__toriiLoginReady) lived at the very END of main.js's module body — after the eager
// `import { renderer } from './scene.js'` (scene.js creates a WebGLRenderer at import time) and after
// the synchronous buildArena()/buildMirror()/initHUD()/… boot sequence. If WebGL was unavailable
// (headless/locked-down browser) or ANY boot step threw, main.js aborted before reaching the login
// wiring, the flag stayed falsy, and the index.html inline fallback kept showing
// "Login still loading - reload the page if this persists." forever — even though login needs NO 3D
// at all (it is just a NIP-07 read). That was the live blocker the tester kept hitting.
//
// THE FIX: login depends only on nostrLogin() (nostr.js → state.js/events.js — no THREE, no scene, no
// WebGL) and two title-screen DOM nodes. main.js now imports THIS module BEFORE ./scene.js, so its
// top-level installLoginBootstrap() runs (and sets __toriiLoginReady) before the renderer is ever
// constructed. A loaded bundle therefore wires login even if the 3D boot later throws. nostrich.
import { nostrLogin } from '../../nostr.js';
import { state } from '../../state.js';
import { on, EV } from '../../events.js';

// The title-screen login button + the single visible status line (both static in index.html).
const LOGIN_BTN_ID = 'btn-nostr-centre';
const STATUS_ID = 'entry-status';

// v0.2.776-alpha (Bug I): arm the LOGIN-NOSTR button once the user has
// actually completed the signer round-trip — flip the CSS state via
// data-armed="true" (styles in index.html), and relabel to "ENTER" so it
// unambiguously reads as "you're in, click to enter the arena". Arming is
// idempotent (safe to call on repeat login attempts). Only fires when we
// see a valid 64-hex pubkey on state, so a rejected/dismissed extension
// prompt leaves the button in its unarmed state and the status line
// carries the actionable message.
export function armLoginEnterButton(doc = (typeof document !== 'undefined' ? document : null)) {
  if (!doc) return false;
  const btn = doc.getElementById(LOGIN_BTN_ID);
  if (!btn) return false;
  // Use setAttribute (universally available on real DOM + fake test doubles)
  // instead of `dataset.armed = '...'` — fake elements in unit tests do not
  // expose a `dataset` proxy, and a throw here would propagate through the
  // EV.NOSTR_LOGIN emit() and crash the login round-trip.
  if (typeof btn.setAttribute === 'function') {
    btn.setAttribute('data-armed', 'true');
    btn.setAttribute('aria-pressed', 'true');
  }
  if ('textContent' in btn) btn.textContent = 'ENTER';
  return true;
}

// showStatus(el, msg) — visible feedback via textContent ONLY (never innerHTML): the kind:0 profile
// name/pubkey is attacker-influenced, so no markup ever reaches the DOM here. Empty msg hides the line.
function showStatus(el, msg) {
  if (!el) return;
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

// doNostrLogin(statusEl) — run the real NIP-07 login and surface a SPECIFIC visible result:
//   • no provider  → "NIP-07 extension not found" (from nostrLogin)
//   • success      → "" (status line hides; no pubkey fragment shown)
//   • provider errors / unexpected throw → an actionable message, never a stuck "Connecting…".
// No network/write beyond the existing NIP-07 read. Exported for tests; safe to call repeatedly.
export async function doNostrLogin(statusEl) {
  showStatus(statusEl, 'Connecting…');
  try {
    const result = await nostrLogin();
    showStatus(statusEl, result);
    return result;
  } catch (e) {
    console.error('Nostr login failed:', e);
    const msg = '⚠ Login failed — approve the request in your Nostr extension, or ENTER ARENA anonymously.';
    showStatus(statusEl, msg);
    return msg;
  }
}

// installLoginBootstrap(doc) — bind the real login handler and raise window.__toriiLoginReady so the
// index.html inline fallback stands down. Idempotent (the readiness flag guards a second bind) and
// dependency-light by design: it must NOT pull in THREE/scene, so it can run before the WebGL boot.
// Returns true when the real handler is now bound. Pure-ish: only touches the DOM + the window flag.
export function installLoginBootstrap(doc = (typeof document !== 'undefined' ? document : null)) {
  if (!doc) return false;
  // Already wired (e.g. a double import) — don't stack a second listener.
  if (typeof window !== 'undefined' && window.__toriiLoginReady) return true;

  const loginBtn = doc.getElementById(LOGIN_BTN_ID);
  const statusEl = doc.getElementById(STATUS_ID);
  // Click routing: while unarmed, the button runs the real Nostr login (which
  // sets state.nostrPubkey + emits EV.NOSTR_LOGIN on success → armLoginEnter
  // Button() flips the button to ENTER via the EV.NOSTR_LOGIN subscriber
  // below). Once armed, the ENTER surface delegates straight into the shared
  // ENTER-ARENA boot path by clicking the guest ENTER button, so we reuse the
  // exact same _bootArena code path with no duplicated wiring here.
  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      if (loginBtn.dataset.armed === 'true') {
        // main.js exposes the shared boot function on window at module init;
        // if it isn't there (e.g. main.js failed to load) the click falls
        // through to the login path, which is still safe (a second login is
        // idempotent) and keeps the button clickable rather than dead.
        const enter = typeof window !== 'undefined' && window.__toriiEnterArenaFromTitle;
        if (typeof enter === 'function') { enter(); return; }
      }
      doNostrLogin(statusEl);
    });
  }

  // Arm on successful login. We listen to EV.NOSTR_LOGIN (fired by nostrLogin
  // right after state.nostrPubkey is set) so armLoginEnterButton() runs even
  // if the button was rebuilt or reattached between click and success. We also
  // arm eagerly here for the case where login already succeeded in this
  // session before installLoginBootstrap ran (unusual but possible on hot
  // re-import); the 64-hex guard makes the eager path safe.
  on(EV.NOSTR_LOGIN, () => { armLoginEnterButton(doc); });
  if (typeof state !== 'undefined' && /^[0-9a-f]{64}$/.test(state?.nostrPubkey || '')) {
    armLoginEnterButton(doc);
  }

  // Signal the inline fallback (index.html) that the REAL handler now owns the click — set even when
  // the button is briefly absent so the fallback's no-provider/"still loading" branch can't linger if
  // the bundle is otherwise healthy. The handler itself is null-guarded above.
  if (typeof window !== 'undefined') window.__toriiLoginReady = true;
  return true;
}

// Auto-install in a real browser the moment this module evaluates — which, because main.js imports it
// before ./scene.js, is BEFORE the WebGLRenderer is constructed. Guarded so importing under node/test
// (no document) is an inert no-op; tests drive installLoginBootstrap()/doNostrLogin() explicitly.
if (typeof document !== 'undefined') installLoginBootstrap();
