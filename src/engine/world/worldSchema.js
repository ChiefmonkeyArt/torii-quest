// engine/world/worldSchema.js — minimal data-driven world manifest schema + the
// validateWorld gate (Phase 0, open-world foundation). The first slice of the
// world layer that replaces the hard-coded buildArena() so every deploy no
// longer lands the same world on every instance (the root cause of the
// "Bekka overwrite"). A world.json manifest describes the scene declaratively;
// this module is the boundary that decides whether a manifest is well-formed
// enough to render from data, or whether the loader should fall back to the
// legacy buildArena() path.
//
// PURE + node-safe: NO DOM, NO window/location, NO browser navigation, NO relay
// I/O, NO signing, NO fetch. It only structurally validates + normalises a
// plain data object into a canonical `world`. Whether/how to ACT on a valid
// world (build the three.js scene from it) is the renderer's separate decision;
// this module never has side effects. Uses only plain JS, so it is importable
// in vitest's node env.
//
// Constrained by construction: validateWorld(data) → { ok, errors, world }.
// Be permissive: ignore unknown fields, coerce where sensible, NEVER throw on
// bad input — return { ok:false, errors } instead. A failure never yields a
// world. The loader treats !ok as "fall back to buildArena()".
//
// Forward-compat: `legacy:true` is the chiefmonkey-template shortcut — the
// manifest carries template metadata but the renderer still uses buildArena().
// Extraction of the chiefmonkey world to true data is Phase 1; this flag keeps
// the template path live today without a renderer for manifest objects.

// Allowed sky.type / platform.type / light.kind values (closed sets).
const SKY_TYPES = Object.freeze(['space', 'clear', 'dusk']);
const PLATFORM_TYPES = Object.freeze(['cloud', 'solid']);
const LIGHT_KINDS = Object.freeze(['ambient', 'directional', 'point']);

function _isBlank(v) { return v == null || v === ''; }

function _isInt(v) { return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v); }

function _isNum(v) { return typeof v === 'number' && Number.isFinite(v); }

function _isStr(v) { return typeof v === 'string'; }

function _isBool(v) { return typeof v === 'boolean'; }

// Coerce a value to a finite number, or undefined if it can't be. Accepts a
// numeric string ("12.5") so hand-authored JSON written loosely still coerces.
function _toNum(v) {
  if (_isNum(v)) return v;
  if (_isStr(v) && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

// Coerce to a [x,y,z] number triple, or undefined. Accepts an array of 3
// numbers or 3 numeric strings. Anything else → undefined (caller drops it).
function _toVec3(v) {
  if (!Array.isArray(v) || v.length !== 3) return undefined;
  const out = v.map(_toNum);
  if (out.some((n) => n === undefined)) return undefined;
  return out;
}

// Coerce to a string, trimmed, or undefined if blank/non-string. Used for
// optional colour / relay fields where a non-string is meaningless.
function _toStr(v) {
  if (!_isStr(v)) return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

// Coerce to a string array of non-blank trimmed strings, or undefined.
function _toStrArray(v) {
  const list = Array.isArray(v) ? v : [v];
  const out = list
    .map((r) => (_isStr(r) ? r.trim() : ''))
    .filter((r) => r !== '');
  return out.length ? out : undefined;
}

// validateWorld(data) → { ok, errors, world }. Pure; never throws. Required
// fields are `version` (must be the int 1), `id` (a slug), and `name`. All other
// fields are optional and permissively coerced; unknown fields are ignored.
// On success `world` is a normalised object carrying only known, coerced fields.
export function validateWorld(data) {
  const errors = [];
  const out = { ok: false, errors, world: null };
  if (data == null || (typeof data !== 'object') || Array.isArray(data)) {
    errors.push('world must be an object');
    return out;
  }

  // version — required, must be the integer 1 (the only schema version today).
  const version = _toNum(data.version);
  if (version === undefined) {
    errors.push('missing required field: version');
  } else if (!_isInt(version)) {
    errors.push('version must be an integer');
  } else if (version !== 1) {
    errors.push('version must be 1');
  }

  // id — required, a slug (lowercase a-z0-9-_, no spaces). Identifies the world
  // dir under worlds/ and the active symlink target.
  const id = _toStr(data.id);
  if (id === undefined) {
    errors.push('missing required field: id');
  } else if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
    errors.push('id must be a slug (lowercase a-z0-9-_)');
  }

  // name — required, any non-blank string.
  const name = _toStr(data.name);
  if (name === undefined) errors.push('missing required field: name');

  if (errors.length) return out;

  // All required fields cleared — build the normalised world. Everything
  // below is optional; bad shapes are dropped (not errors) so a manifest can
  // ship a subset of the optional fields and still validate.
  const world = { version: 1, id, name };

  // legacy — bool, default false. When true the loader routes to buildArena().
  world.legacy = _isBool(data.legacy) ? data.legacy : false;

  // sky { type, color?, stars? }
  if (data.sky != null && typeof data.sky === 'object' && !Array.isArray(data.sky)) {
    const sky = {};
    const sType = _toStr(data.sky.type);
    if (sType && SKY_TYPES.includes(sType)) sky.type = sType;
    const sColor = _toStr(data.sky.color);
    if (sColor) sky.color = sColor;
    if (_isBool(data.sky.stars)) sky.stars = data.sky.stars;
    if (Object.keys(sky).length) world.sky = sky;
  }

  // platform { type, size?, color? }
  if (data.platform != null && typeof data.platform === 'object' && !Array.isArray(data.platform)) {
    const platform = {};
    const pType = _toStr(data.platform.type);
    if (pType && PLATFORM_TYPES.includes(pType)) platform.type = pType;
    const pSize = _toNum(data.platform.size);
    if (pSize !== undefined && pSize > 0) platform.size = pSize;
    const pColor = _toStr(data.platform.color);
    if (pColor) platform.color = pColor;
    if (Object.keys(platform).length) world.platform = platform;
  }

  // gateway { position, target?, relays? }
  if (data.gateway != null && typeof data.gateway === 'object' && !Array.isArray(data.gateway)) {
    const gateway = {};
    const gPos = _toVec3(data.gateway.position);
    if (gPos) gateway.position = gPos;
    const gTarget = _toVec3(data.gateway.target);
    if (gTarget) gateway.target = gTarget;
    const gRelays = _toStrArray(data.gateway.relays);
    if (gRelays) gateway.relays = gRelays;
    if (Object.keys(gateway).length) world.gateway = gateway;
  }

  // spawn { position, yaw? }
  if (data.spawn != null && typeof data.spawn === 'object' && !Array.isArray(data.spawn)) {
    const spawn = {};
    const sPos = _toVec3(data.spawn.position);
    if (sPos) spawn.position = sPos;
    const sYaw = _toNum(data.spawn.yaw);
    if (sYaw !== undefined) spawn.yaw = sYaw;
    if (Object.keys(spawn).length) world.spawn = spawn;
  }

  // lights [ { kind, color?, intensity?, position? } ]
  if (Array.isArray(data.lights)) {
    const lights = [];
    for (const item of data.lights) {
      if (item == null || typeof item !== 'object' || Array.isArray(item)) continue;
      const light = {};
      const lKind = _toStr(item.kind);
      if (lKind && LIGHT_KINDS.includes(lKind)) light.kind = lKind;
      const lColor = _toStr(item.color);
      if (lColor) light.color = lColor;
      const lIntensity = _toNum(item.intensity);
      if (lIntensity !== undefined) light.intensity = lIntensity;
      const lPos = _toVec3(item.position);
      if (lPos) light.position = lPos;
      if (Object.keys(light).length) lights.push(light);
    }
    if (lights.length) world.lights = lights;
  }

  // objects — optional array, reserved for future component placement. Kept
  // verbatim only if it is an array; contents are not validated yet (Phase 1).
  if (Array.isArray(data.objects)) world.objects = data.objects;

  out.world = world;
  out.ok = true;
  return out;
}
