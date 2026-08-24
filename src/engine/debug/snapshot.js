// engine/debug/snapshot.js — pure, JSON-serialisable debug snapshot builder.
// v0.2.130. Assembles ONE compact object a tester can paste from the console
// after a playtest: `ToriiDebug.snapshot()` (and the focused `combat.report()` /
// `physics.report()`). Pure: every field comes from an injected provider, and
// each read runs behind safe() so a not-yet-initialised system yields null
// instead of throwing — the surface is safe to call at any time (title screen,
// before physics loads, mid-run). No Three/Rapier/DOM imports, so it unit-tests
// in node against plain fake providers.

// Call provider fn() and return its value; on a throw, a missing provider, or a
// non-function, return the fallback. Never propagates an error to the caller.
function safe(fn, fb = null) {
  try { return typeof fn === 'function' ? fn() : fb; }
  catch { return fb; }
}

// Round a finite number to keep snapshots compact + stable (no 17-digit float
// noise in a pasted console object). Non-numbers pass through unchanged.
function round(n, d = 3) {
  if (typeof n !== 'number' || !isFinite(n)) return n;
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

// {x,y,z}-like → a rounded plain triple, or null.
function vec3(v) {
  return v ? { x: round(v.x), y: round(v.y), z: round(v.z) } : null;
}

// Combat sub-report — last hit/shot/miss classification snapshots. These are
// already plain objects (or null) in weapons.js, so they serialise directly.
export function buildCombatReport(p = {}) {
  return {
    lastHit:  safe(p.getLastHit),
    lastShot: safe(p.getLastShot),
    lastMiss: safe(p.getLastMiss),
    // ADR-0046 v0.2.667: the ACTUAL buildShotPayload output sent to the server
    // {ts,viewLag,usedAimRay,sentOrigin,sentDir,muzzleOrigin,muzzleDir,aimOrigin,
    //  aimDir}. Independent of lastShot (which is only created when
    //  aimOrigin/aimDir are present) so it is never stale in the usedAimRay=false
    //  failure case. Proves camera-vs-muzzle.
    lastSentShot: safe(p.getLastSentShot),
  };
}

// Physics sub-report — world readiness + body/collider/bot/crate summary. Counts
// only (the Rapier world itself is not serialisable).
export function buildPhysicsReport(p = {}) {
  return {
    ready:     safe(p.isPhysicsReady, false) ?? false,
    bodies:    safe(p.getBodyCount),
    colliders: safe(p.getColliderCount),
    bots:      safe(p.getBotSummary),
    crates:    safe(p.getCrateSummary),
  };
}

// Kami Mode sub-report — the exact client-side Kami state at snapshot time, so
// an ema hung while "stuck in Kami Mode" tells us WHICH flag is wrong: active
// (spirit state), noteOpen (editor open), entering (pending owner-check), and
// pointerLocked (browser pointer lock). ADR-0052.
export function buildKamiReport(p = {}) {
  return {
    active:        safe(p.isKamiActive, false) ?? false,
    noteOpen:      safe(p.isKamiNoteOpen, false) ?? false,
    entering:      safe(p.isKamiEntering, false) ?? false,
    pointerLocked: safe(p.isPointerLocked, false) ?? false,
  };
}

// ADR-0055: auto-capture state — the 1Hz diagnostic ring status so a manual
// ema hung at an incident points at the nearby auto-capture frames (by ts).
export function buildAutoCaptureReport(p = {}) {
  const r = safe(p.getAutoCaptureReport);
  if (!r || typeof r !== 'object') return null;
  return {
    enabled:         safe(() => r.enabled, false) ?? false,
    intervalMs:      safe(() => r.intervalMs),
    inflight:        safe(() => r.inflight, false) ?? false,
    lastFrameId:     safe(() => r.lastFrameId),
    lastCapturedAt:  safe(() => r.lastCapturedAt),
    lastUploadOkAt: safe(() => r.lastUploadOkAt),
    lastError:       safe(() => r.lastError),
    captured:        safe(() => r.captured),
    uploaded:        safe(() => r.uploaded),
    failed:          safe(() => r.failed),
  };
}

// Full snapshot. Order is intentional: identity → phase → player → combat →
// physics → tuning, so a pasted object reads top-to-bottom like a status line.
export function buildSnapshot(p = {}) {
  return {
    version: safe(() => p.version) ?? null,
    phase:   safe(p.getPhase),
    state:   safe(p.getState),
    player:  vec3(safe(p.getPlayerPos)),
    combat:  buildCombatReport(p),
    physics: buildPhysicsReport(p),
    // ADR-0052: Kami Mode client state — active/noteOpen/entering/pointerLocked.
    kami:    buildKamiReport(p),
    // ADR-0055: 1Hz auto-capture ring status — points a hung ema at nearby frames.
    autoCapture: buildAutoCaptureReport(p),
    // ADR-0045 v0.2.666: per-bot render state so an ema tells us WHICH branch is
    // broken when bots appear as cubes / floating nameplates with no body.
    bots:     safe(p.getBotRenderStates),
    config:  safe(() => p.config) ?? null,
  };
}
