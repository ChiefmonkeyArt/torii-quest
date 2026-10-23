// engine/world/homeWorld.js — ADR-0147 Milestone 1 (v0.2.923): the home world is
// loaded from its OWN world description (`worlds/home/world.json`). Its
// `components` list decides which Starter Pack pieces the classic builder runs.
//
// Migration rule: only pieces already migrated to components (STARTER_PACK
// `builtIn: true`) are gated by the list. Pieces not migrated yet are always
// built, so nothing disappears before its component exists.
//
// v0.2.924: the shipped description is BUNDLED into the app. On a VPS,
// /quest/worlds/ is the operator's own data dir (data/worlds/, seeded once and
// never overwritten by updates), so a new template never reaches it. Order:
//   1. the operator's file at <base>worlds/home/world.json (their override);
//   2. 404 / unreadable → the bundled description (source 'bundled');
//   3. bundled copy invalid too → the FULL Starter Pack (source 'default').
// A home can never boot into nothing.
//
// PURE except loadHomeWorld (which takes an injected fetch).
import { STARTER_PACK, starterPackEntry } from '../components/starterPack.js';
import { validateWorld } from './worldSchema.js';
import BUNDLED_HOME_WORLD from '../../../worlds/home/world.json';

export { BUNDLED_HOME_WORLD };

export const HOME_WORLD_PATH = 'worlds/home/world.json';
export const HOME_WORLD_MAX_BYTES = 64 * 1024;
// Ground the home needs until a platform component exists (else the player falls).
export const HOME_MAX_COMPONENTS = 256;
export const HOME_REQUIRED = Object.freeze(['world.island']);

const FULL = () => new Set(STARTER_PACK.map((c) => c.id));

/**
 * world → { plan:Set<id>, source:'file'|'default', errors:string[] }.
 * Unknown ids are reported and ignored; required ids are put back.
 */
export function planFromWorld(world) {
  const errors = [];
  if (!world || typeof world !== 'object') return { plan: FULL(), source: 'default', errors: ['no world'] };
  const checked = validateWorld(world);
  if (!checked.ok || !checked.world) return { plan: FULL(), source: 'default', errors: ['invalid world: ' + (checked.errors || []).slice(0, 3).join('; ')] };
  // The RAW list: the schema drops an empty/invalid list, but an owner's
  // `components: []` means "nothing" (bar the required ground), not "everything".
  const list = world.components;
  if (!Array.isArray(list)) return { plan: FULL(), source: 'default', errors: ['no components list'] };
  if (list.length > HOME_MAX_COMPONENTS) return { plan: FULL(), source: 'default', errors: [`too many components (${list.length})`] };
  const plan = new Set();
  list.forEach((inst, i) => {
    const id = inst && typeof inst.id === 'string' ? inst.id : null;
    if (!id) { errors.push(`components[${i}]: missing id`); return; }
    if (!starterPackEntry(id)) { errors.push(`components[${i}]: unknown component ${id.slice(0, 64)}`); return; }
    plan.add(id);
  });
  for (const id of HOME_REQUIRED) if (!plan.has(id)) { plan.add(id); errors.push(`${id} is required for a home world; kept`); }
  return { plan, source: 'file', errors };
}

/**
 * Does the home build this piece? Pieces not yet migrated are always built.
 * `plan` null → full pack.
 */
export function homeIncludes(plan, id) {
  if (!plan) return true;
  const e = starterPackEntry(id);
  if (!e || !e.builtIn) return true;
  return plan.has(id);
}

// The bundled description's plan; `error` (if any) explains why it was used.
function _bundled(fallback, error) {
  const r = planFromWorld(fallback);
  if (r.source !== 'file') return { plan: r.plan, source: 'default', errors: [...(error ? [error] : []), ...r.errors] };
  return { plan: r.plan, source: 'bundled', errors: [...(error ? [error] : []), ...r.errors] };
}

/**
 * Fetch + plan the home world. Never throws. A 404 is normal (no operator
 * override) → the bundled description, with no error.
 */
export async function loadHomeWorld({ fetchImpl, base = '', fallback = BUNDLED_HOME_WORLD } = {}) {
  if (typeof fetchImpl !== 'function') return _bundled(fallback, 'no fetch');
  try {
    const res = await fetchImpl(base + HOME_WORLD_PATH, { cache: 'no-cache', credentials: 'same-origin' });
    if (res && res.status === 404) return _bundled(fallback, null);
    if (!res || !res.ok) return _bundled(fallback, `home world unavailable (${res ? res.status : 'no response'})`);
    const text = await res.text();
    if (text.length > HOME_WORLD_MAX_BYTES) return _bundled(fallback, 'home world too large');
    let world;
    try { world = JSON.parse(text); } catch { return _bundled(fallback, 'home world is not JSON'); }
    const r = planFromWorld(world);
    return r.source === 'file' ? r : _bundled(fallback, r.errors[0] || 'home world invalid');
  } catch (e) {
    return _bundled(fallback, 'home world fetch failed: ' + (e && e.message ? e.message : String(e)));
  }
}
