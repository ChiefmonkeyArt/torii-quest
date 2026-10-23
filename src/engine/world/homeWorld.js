// engine/world/homeWorld.js — ADR-0147 Milestone 1 (v0.2.923): the home world is
// loaded from its OWN world description (`worlds/home/world.json`). Its
// `components` list decides which Starter Pack pieces the classic builder runs.
//
// Migration rule: only pieces already migrated to components (STARTER_PACK
// `builtIn: true`) are gated by the list. Pieces not migrated yet are always
// built, so nothing disappears before its component exists.
//
// Fail-safe: a missing, unreadable or invalid file → the FULL Starter Pack (the
// classic home, unchanged). A home can never boot into nothing.
//
// PURE except loadHomeWorld (which takes an injected fetch).
import { STARTER_PACK, starterPackEntry } from '../components/starterPack.js';
import { validateWorld } from './worldSchema.js';

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

/** Fetch + plan the home world. Never throws; falls back to the full pack. */
export async function loadHomeWorld({ fetchImpl, base = '' } = {}) {
  if (typeof fetchImpl !== 'function') return { plan: FULL(), source: 'default', errors: ['no fetch'] };
  try {
    const res = await fetchImpl(base + HOME_WORLD_PATH, { cache: 'no-cache', credentials: 'same-origin' });
    if (!res || !res.ok) return { plan: FULL(), source: 'default', errors: [`home world not found (${res ? res.status : 'no response'})`] };
    const text = await res.text();
    if (text.length > HOME_WORLD_MAX_BYTES) return { plan: FULL(), source: 'default', errors: ['home world too large'] };
    let world;
    try { world = JSON.parse(text); } catch { return { plan: FULL(), source: 'default', errors: ['home world is not JSON'] }; }
    return planFromWorld(world);
  } catch (e) {
    return { plan: FULL(), source: 'default', errors: ['home world fetch failed: ' + (e && e.message ? e.message : String(e))] };
  }
}
