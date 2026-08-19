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

// Allowed object.type values (closed set). `gltf` loads a GLB/GLTF model; the
// primitives (`box`/`cylinder`/`plane`) are placed meshes; `torii-gate` is a
// named alias that resolves to the chiefmonkey gate GLB (torii-gate.glb).
// NOTE: the ground heightfield is NOT an object type — it is the singular
// top-level `terrain` field (one ground per world), validated separately below.
const OBJECT_TYPES = Object.freeze(['gltf', 'box', 'cylinder', 'torii-gate', 'plane', 'coastline-wall']);
// Allowed collider.shape values (closed set, Phase 0i). `box` is a full-extent
// cuboid (size = [x,y,z]); `cylinder` is a Y-axis cylinder (radius + height). A
// malformed collider is SILENTLY OMITTED (the object stays valid + visual-only)
// — it never pushes to errors, so a bad collider can never fail the whole world
// (which would force fallback:legacy). Mirrors the optional scale/rotation style.
const COLLIDER_SHAPES = Object.freeze(['box', 'cylinder']);
// Hard cap on the objects array — a bad manifest must not create thousands of
// meshes. Beyond this is a hard error (loud rejection, matching validateWorld's
// strict style) so a malformed manifest is never silently truncated.
const OBJECT_CAP = 64;

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

  // terrain { source, rows, cols, scale, offset?, seaLevel? } — the singular ground
  // heightfield (Phase 0k.5). One terrain per world (like sky/platform/gateway).
  // `source` is a safe relative module path (.js/.json) exporting the heights: a
  // Float32Array (column-major: heights[col*rows + row]) OR a `buildHeightfieldArray()`
  // function returning one (preferred — avoids eager allocation). The loader imports
  // it dynamically (the heights grid is too large to inline in world.json). `rows`/`cols`
  // are VERTEX counts (rowsZ, colsX) and must be >= 2 (Rapier needs >= 1 cell = >= 2
  // vertices per axis). `scale` is TOTAL extents [gWidth, heightScale, gDepth] (NOT
  // per-cell) — scaleY is typically 1 so heights are absolute world-Y metres. `offset`
  // is the Rapier CENTRE translation [cx, cy, cz] (the heightfield spans
  // [-scaleX/2, scaleX/2] × [-scaleZ/2, scaleZ/2] around it; cy is usually 0). This is
  // the data-driven mirror of the legacy buildArena() terrain heightfield (physics.js
  // createHeightfield: nrows=rows-1, ncols=cols-1, heights, scale, centre). All-or-
  // nothing: source+rows+cols+scale must ALL be valid, else the terrain is silently
  // omitted from the WORLD (the world still validates ok). NOTE: a terrain present but
  // unbuildable at render time (bad heights length, non-finite values, source load
  // failure) is NOT silently skipped — buildWorldTerrain returns a structured failure
  // so arenaRuntime falls back to legacy buildArena() (the ground must never vanish).
  if (data.terrain != null && typeof data.terrain === 'object' && !Array.isArray(data.terrain)) {
    const tSource = _safeDataSourcePath(data.terrain.source);
    const tRows = _toNum(data.terrain.rows);
    const tCols = _toNum(data.terrain.cols);
    const tScale = _toVec3(data.terrain.scale);
    const rowsOk = tRows !== undefined && _isInt(tRows) && tRows >= 2;
    const colsOk = tCols !== undefined && _isInt(tCols) && tCols >= 2;
    const scaleOk = !!(tScale && tScale.every((n) => n > 0));
    if (tSource && rowsOk && colsOk && scaleOk) {
      const terrain = { source: tSource, rows: tRows, cols: tCols, scale: tScale };
      const tOffset = _toVec3(data.terrain.offset);
      if (tOffset) terrain.offset = tOffset;
      const tSea = _toNum(data.terrain.seaLevel);
      if (tSea !== undefined) terrain.seaLevel = tSea;
      world.terrain = terrain;
    }
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

  // objects — optional array of placed scene objects (Phase 0e). Each entry is
  // validated per-item: a valid entry is pushed to world.objects; an invalid entry
  // is dropped (errors recorded) WITHOUT failing the whole world — matching the
  // lights[] per-item style so one bad object doesn't kill a valid manifest. The
  // array itself is hard-capped at OBJECT_CAP entries; beyond that is a loud
  // error (reject the whole world) so a malformed manifest can't create a flood
  // of meshes. `gltf`/`torii-gate` carry a model path that must pass _safeModelPath
  // (relative only, no `..`, no protocol, .glb/.gltf only).
  if (Array.isArray(data.objects)) {
    if (data.objects.length > OBJECT_CAP) {
      errors.push(`objects exceeds cap of ${OBJECT_CAP} (got ${data.objects.length})`);
      return out;
    }
    const objects = [];
    for (let i = 0; i < data.objects.length; i++) {
      const item = data.objects[i];
      if (item == null || typeof item !== 'object' || Array.isArray(item)) {
        errors.push(`objects[${i}] must be an object`);
        continue;
      }
      const obj = _validateObject(item, i, errors);
      if (obj) objects.push(obj);
    }
    if (objects.length) world.objects = objects;
  }

  out.world = world;
  out.ok = true;
  return out;
}

// ── Object validation helpers (Phase 0e) ─────────────────────────────────────

// _safeModelPath(raw) → a sanitized relative model path or null. Pure.
// Rules: must be a string, ≤ 128 chars, no `..` segments, no `://`, no leading
// `/`, must end `.glb` or `.gltf`. Used by _validateObject so a manifest can
// never load an arbitrary external URL or escape the world's asset dir. Returns
// the trimmed path on success, or null on any violation (caller records an
// error + drops the object).
export function _safeModelPath(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s === '' || s.length > 128) return null;
  if (s.startsWith('/')) return null; // no absolute paths
  if (s.includes('://')) return null; // no protocol/host
  // Reject any `..` segment (path traversal escape).
  const parts = s.split('/');
  if (parts.some((p) => p === '..')) return null;
  // Extension must be .glb or .gltf only.
  if (!(s.endsWith('.glb') || s.endsWith('.gltf'))) return null;
  return s;
}

// _safeDataSourcePath(raw) → a sanitized relative data-module path or null. Pure.
// Like _safeModelPath but for terrain heightfield data modules (.js/.json) that
// export the heights array. Rules: string, ≤ 256 chars, no `..` segment, no
// `://`, no leading `/`, must end `.js` or `.json`. Used by the terrain field so
// a manifest can never load an arbitrary external URL or escape the world's
// asset dir. Returns the trimmed path on success, or null on any violation.
export function _safeDataSourcePath(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s === '' || s.length > 256) return null;
  if (s.startsWith('/')) return null; // no absolute paths
  if (s.includes('://')) return null; // no protocol/host
  const parts = s.split('/');
  if (parts.some((p) => p === '..')) return null; // no path traversal
  if (!(s.endsWith('.js') || s.endsWith('.json'))) return null;
  return s;
}

// _validateCollider(raw) → a normalised collider or undefined. Pure.
// Validates the optional `collider` field of an objects[] entry (Phase 0i).
// Returns a normalised { shape, size?/radius+height, offset, sensor } on success,
// or undefined on ANY malformed field. CRITICAL contract: a malformed collider
// is SILENTLY OMITTED — this helper NEVER pushes to `errors`. A bad collider must
// not fail the whole world (which would force fallback:legacy); the object just
// stays visual-only, exactly like a malformed optional `scale`/`rotation`.
//   - absent / null / false / true / non-object → no collider (undefined).
//   - shape: required, one of COLLIDER_SHAPES. Else undefined.
//   - box: size [x,y,z] positive numbers (full extents). Else undefined.
//   - cylinder: radius + height positive numbers. Else undefined.
//   - offset: optional [x,y,z] numbers (any sign). Defaults to [0,0,0].
//   - sensor: optional boolean. Defaults to false.
function _validateCollider(raw) {
  if (raw == null || raw === false || raw === true) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;

  const shape = _toStr(raw.shape);
  if (!shape || !COLLIDER_SHAPES.includes(shape)) return undefined;

  const out = { shape };

  if (shape === 'box') {
    const size = _toVec3(raw.size);
    if (!size) return undefined;
    if (!(size[0] > 0 && size[1] > 0 && size[2] > 0)) return undefined;
    out.size = size;
  } else { // cylinder (Y-axis)
    const radius = _toNum(raw.radius);
    const height = _toNum(raw.height);
    if (radius === undefined || height === undefined) return undefined;
    if (!(radius > 0 && height > 0)) return undefined;
    out.radius = radius;
    out.height = height;
  }

  // offset — optional [x,y,z] numbers (any sign; a collider may sit below/above
  // the object origin). Defaults to [0,0,0]. A malformed offset is dropped to the
  // default rather than failing the whole collider (permissive, like scale).
  const offset = _toVec3(raw.offset);
  out.offset = offset || [0, 0, 0];

  // sensor — optional boolean (a sensor collider reports contacts without
  // physically blocking). A non-boolean is dropped to the default (false).
  out.sensor = _isBool(raw.sensor) ? raw.sensor : false;

  return out;
}

// _validateObject(item, index, errors) → a normalised object or null. Pure.
// Validates a single objects[] entry. Required: `type` (closed set), `position`
// ([x,y,z]). Optional: `rotation` ([x,y,z] radians), `scale` (number or
// [x,y,z]), `color` (CSS hex string), `model` (required for `gltf`, forbidden
// otherwise), `collider` (Phase 0i; malformed → silently omitted). A valid entry
// → a normalised object; invalid → an error is pushed to `errors` + null returned
// (the caller drops it without failing the world).
function _validateObject(item, index, errors) {
  const obj = {};
  const tag = `objects[${index}]`;

  // type — required, closed set.
  const type = _toStr(item.type);
  if (!type) {
    errors.push(`${tag}: missing required field: type`);
    return null;
  }
  if (!OBJECT_TYPES.includes(type)) {
    errors.push(`${tag}: type must be one of ${OBJECT_TYPES.join(', ')}`);
    return null;
  }
  obj.type = type;

  // coastline-wall — collision-only segment-set. No position/mesh; it carries a
  // `source` path to a baked segment-set JSON that the collider builder expands
  // into N cuboid colliders at runtime. Validated like the terrain `source`.
  if (type === 'coastline-wall') {
    const source = _safeDataSourcePath(item.source, `${tag}.source`, errors);
    if (!source) return null;
    obj.source = source;
    return obj;
  }

  // position — required [x,y,z] numbers.
  const pos = _toVec3(item.position);
  if (!pos) {
    errors.push(`${tag}: missing/invalid position (expected [x,y,z])`);
    return null;
  }
  obj.position = pos;

  // rotation — optional [x,y,z] radians.
  const rot = _toVec3(item.rotation);
  if (rot) obj.rotation = rot;

  // scale — optional uniform number OR [x,y,z].
  if (item.scale != null) {
    if (Array.isArray(item.scale)) {
      const sv = _toVec3(item.scale);
      if (sv) obj.scale = sv;
    } else {
      const sn = _toNum(item.scale);
      if (sn !== undefined && sn > 0) obj.scale = sn;
    }
  }

  // color — optional CSS hex string (validated like the existing color fields).
  const color = _toStr(item.color);
  if (color) obj.color = color;

  // visible — optional boolean (Phase 0k.3). Defaults to true (object renders a
  // mesh). When explicitly `false`, the object is COLLISION-ONLY: no visual mesh
  // is built by worldObjectsRenderer, but buildWorldObjectColliders still builds its
  // collider (it checks `collider`, not `visible`). Used for legacy collision-only
  // scenery like torii pillars (OBSTACLES) + the coastline wall. Only `false` is
  // preserved — any other value is omitted (object stays visible, the default).
  if (item.visible === false) obj.visible = false;

  // collider — optional per-object physics collider (Phase 0i). A malformed
  // collider is SILENTLY OMITTED (the object stays valid + visual-only) — it
  // never pushes to errors, so a bad collider can never fail the whole world.
  // Mirrors the optional scale/rotation omit-on-bad-shape style.
  const collider = _validateCollider(item.collider);
  if (collider) obj.collider = collider;

  // model — required for type:'gltf', forbidden otherwise. For 'torii-gate' the
  // model is the named alias (torii-gate.glb) resolved by the renderer; a
  // manifest MAY override it with a safe path, but it is NOT required.
  if (type === 'gltf') {
    const model = _safeModelPath(item.model);
    if (!model) {
      errors.push(`${tag}: type 'gltf' requires a safe model path (.glb/.gltf, relative, no ..)`);
      return null;
    }
    obj.model = model;
  } else if (type === 'torii-gate') {
    // Optional override; if present it must still be safe.
    if (item.model != null) {
      const model = _safeModelPath(item.model);
      if (!model) {
        errors.push(`${tag}: torii-gate model override must be a safe path (.glb/.gltf, relative, no ..)`);
        return null;
      }
      obj.model = model;
    }
  } else {
    // Primitives (box/cylinder/plane) must NOT carry a model.
    if (item.model != null) {
      errors.push(`${tag}: type '${type}' must not carry a model`);
      return null;
    }
  }

  return obj;
}
