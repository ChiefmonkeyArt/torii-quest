// peerCombat.js — pure MP-2 peer-combat bridge (v0.2.374-alpha).
//
// Server-authoritative combat: the server ray-resolves every SHOT against
// lag-compensated peer snapshots and broadcasts the authoritative HIT/KILL. This
// module holds the CLIENT-side decisions (outbound gate + payload, inbound
// dispatch) as pure functions so they can be unit-tested away from the
// three/DOM-heavy arenaRuntime, which stays a thin wiring seam.
//
// Deliberately NO local peer hit detection: relayed peer SHOT is visual-only.
// Local bot hits remain a separate client-side path (see EV.BOT_HIT_BY_PLAYER) —
// a single shot may both hit a bot locally AND resolve a peer hit server-side;
// that double path is expected and is NOT deduped here.

// Outbound gate — send a SHOT only once we have a server-assigned identity
// (selfId, set from WELCOME) and the shooter is inside the arena (not the NAP
// zone, where the weapon reads as inert).
export function shouldSendShot({ playerX, napX, selfId }) {
  return !!selfId && playerX <= napX;
}

// Build the outbound SHOT payload. Prefer the AIM ray (camera through the
// crosshair) so server hit-detection matches what the shooter saw on-screen;
// fall back to the muzzle origin/dir when no aim ray is present. Vectors are
// serialised to [x,y,z] arrays (the wire format). Returns null when neither ray
// is available — the caller then sends nothing.
//
// v0.2.392 hit-reg: `ts` is the client's RAW Date.now() (kept for logging only —
// the client clock is NOT synced to the server, so the server must never use it
// to rewind). `viewLag` (ms) is how far behind live the shooter's view is (render
// interp delay + network one-way); the server rewinds in ITS OWN clock frame as
// server_now − viewLag. See multiplayerHost.viewLagMs().
export function buildShotPayload({ origin, dir, aimOrigin, aimDir }, now, viewLag) {
  const o = aimOrigin || origin;
  const d = aimDir || dir;
  if (!o || !d) return null;
  const shot = { origin: [o.x, o.y, o.z], dir: [d.x, d.y, d.z], ts: now };
  if (Number.isFinite(viewLag)) shot.viewLag = viewLag;
  return shot;
}

// Inbound dispatcher for the relayed/broadcast combat events. `deps` injects the
// player entity boundary + fx + score so this module imports neither three nor
// the DOM. Returns true when it handled the event, false otherwise (so the
// caller can fall through to non-combat events like mp_respawn).
export function createPeerCombat(deps) {
  const {
    getSelfId, takeDamage, killPlayer, flashCross, addKill,
    spawnPeerShotFx, state, onHudUpdate,
  } = deps;

  return function handlePeerCombat(name, payload) {
    if (name !== 'mp_shot' && name !== 'mp_hit' && name !== 'mp_kill') return false;

    const p = payload || {};
    const self = getSelfId();
    if (!self) return true; // combat traffic is meaningless before WELCOME

    // Relayed peer SHOT — VISUAL ONLY. Skip our own shot echoed back. No hit
    // detection, no local damage: the server owns peer hit resolution.
    if (name === 'mp_shot') {
      if (p.id === self) return true;
      if (!Array.isArray(p.origin) || !Array.isArray(p.dir)) return true;
      spawnPeerShotFx(p.origin, p.dir);
      return true;
    }

    // Authoritative HIT. Wire shooter field is `id` (wireProtocol MSG.HIT). Take
    // damage only when WE are the target; flash the crosshair when WE landed it.
    if (name === 'mp_hit') {
      if (p.targetId === self && typeof p.dmg === 'number') takeDamage(p.dmg);
      if (p.id === self) flashCross();
      onHudUpdate();
      return true;
    }

    // Authoritative KILL. If WE died, killPlayer() drives the death/respawn timer
    // and increments state.deaths; it is transition-guarded, so it is a no-op when
    // takeDamage already killed us this frame (deaths never double-counts). If WE
    // got the frag, score it + push a killfeed line.
    if (name === 'mp_kill') {
      if (p.victimId === self) killPlayer();
      if (p.shooterId === self) { state.kills++; addKill('Fragged a rival'); }
      onHudUpdate();
      return true;
    }

    return true;
  };
}
