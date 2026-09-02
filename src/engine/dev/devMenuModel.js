// engine/dev/devMenuModel.js — pure state + registry for the Kami-mode dev menu.
//
// ADR-0099 (v0.2.743-alpha): the operator has been discovering runtime A/B
// toggles by memorising `ToriiDebug.*` console incantations. That's fine for the
// prototype phase but doesn't scale as toggles multiply. This model backs a
// discoverable in-world dev menu that only appears in Kami Mode for the owner
// (never on the public perpetual-world view).
//
// Design constraints (why this module is pure):
//  • Handlers gate is enforced in CODE, not just UI (project rule). This model
//    accepts a `visible` predicate; if visible is false, `applyToggle()` refuses
//    to run the entry's set-handler. A synthesized DOM click via devtools when
//    not-Kami-not-owner therefore still no-ops.
//  • No THREE, no DOM, no timers. All impure edges are injected. Trivially
//    testable under vitest without a browser.
//  • The DOM driver (devMenu.js) reads state via `renderModel()` and dispatches
//    intents via `applyToggle()`. It never touches this module's internals.

// A single registry entry.
//
// {
//   id:      string  — stable key, used as DOM id suffix. Must match /^[a-z0-9-]+$/.
//   label:   string  — human-readable label rendered on the row.
//   hint?:   string  — optional short description under the label.
//   get:     () => boolean   — read current toggle state from the source of truth.
//   set:     (on:boolean) => void  — mutate the source of truth. May throw; the
//            model catches and reports on the returned intent result.
// }
//
// Entries are dumb pipes: this model does NOT persist state itself — a toggle's
// truth lives wherever `get`/`set` point (e.g. stickerRenderMode.js). That way a
// toggle wired here + a `ToriiDebug.*` console flip stay in perfect sync.

function isValidId(id) {
  return typeof id === 'string' && id.length > 0 && /^[a-z0-9-]+$/.test(id);
}

function isEntry(x) {
  return (
    x
    && isValidId(x.id)
    && typeof x.label === 'string' && x.label.length > 0
    && typeof x.get === 'function'
    && typeof x.set === 'function'
    && (x.hint === undefined || typeof x.hint === 'string')
  );
}

// createDevMenuModel({ isVisible }) — factory.
//
// isVisible: () => boolean. Injected — typically
//   () => kamiActive() && kamiIsOwner()
// but tests inject a stub.
export function createDevMenuModel({ isVisible } = {}) {
  if (typeof isVisible !== 'function') {
    throw new Error('createDevMenuModel: isVisible predicate required');
  }
  const entries = [];

  function register(entry) {
    if (!isEntry(entry)) {
      throw new Error('devMenu.register: invalid entry shape');
    }
    if (entries.some((e) => e.id === entry.id)) {
      throw new Error(`devMenu.register: duplicate id "${entry.id}"`);
    }
    entries.push({
      id: entry.id,
      label: entry.label,
      hint: entry.hint || '',
      get: entry.get,
      set: entry.set,
    });
    return entry.id;
  }

  // renderModel() — a snapshot of what the DOM driver should draw. The model is
  // FROZEN so the DOM driver can't mutate it back into us by accident. If
  // visible=false, entries[] is empty on purpose — the driver hides the whole
  // panel and wipes its body.
  function renderModel() {
    const visible = !!isVisible();
    if (!visible) return Object.freeze({ visible: false, entries: [] });
    const snap = entries.map((e) => Object.freeze({
      id: e.id,
      label: e.label,
      hint: e.hint,
      on: !!safeCall(e.get, false),
    }));
    return Object.freeze({ visible: true, entries: Object.freeze(snap) });
  }

  // applyToggle(id, on) — apply intent. Returns { ok, id, on, reason? }.
  // Gate enforced HERE, not just in the UI: if isVisible() is false, the intent
  // is refused even if the caller passed a valid id.
  function applyToggle(id, on) {
    if (!isVisible()) return { ok: false, id, on: !!on, reason: 'not-visible' };
    const entry = entries.find((e) => e.id === id);
    if (!entry) return { ok: false, id, on: !!on, reason: 'unknown-id' };
    try {
      entry.set(!!on);
      const now = !!safeCall(entry.get, !!on);
      return { ok: true, id, on: now };
    } catch (err) {
      return { ok: false, id, on: !!on, reason: 'set-threw', error: String(err && err.message || err) };
    }
  }

  // entryCount() — small introspection helper for tests.
  function entryCount() { return entries.length; }

  return { register, renderModel, applyToggle, entryCount };
}

function safeCall(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}
