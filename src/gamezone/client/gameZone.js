// src/gamezone/client/gameZone.js — Game Zone v2 client orchestrator (ADR-0130).
//
// Owns everything combat looks like and feels like in the arena, and nothing
// else. arenaRuntime calls exactly four things: create → fire (on EV.SHOOT in
// the arena) → frame (once per rendered frame) → clear/dispose (world swap /
// leave). All rules live in the shared core sim; this file only:
//   • picks the authority (VPS sim when multiplayer is live, the in-browser sim
//     otherwise) and switches cleanly between them,
//   • renders the authority's snapshot (views reconciled every frame → no ghosts),
//   • hit-tests the player's shot against the RENDERED meshes and sends a claim,
//   • predicts the outcome (flash, hitmarker, lethal shot → death clip now) and
//     reconciles with the authority's result,
//   • turns authority events into HUD/score/audio/FX.
// No timers, no setTimeout, no per-shot allocation of scene objects.

import * as THREE from 'three';
import { BOT_KINDS, FIRE_RANGE, HEAD_DAMAGE, BODY_DAMAGE, KILL_SATS } from '../core/constants.js';
import { botName } from '../core/sim.js';
import { createBotView, loadBotTemplate } from './botView.js';
import { reconcileViews, clearViews } from './reconciler.js';
import { createLocalAuthority, createNetAuthority, LOCAL_ID } from './authority.js';
import { createGzFx, TRACER_PLAYER, TRACER_BOT, TRACER_PEER } from './fx.js';
import { isClientSuspended } from '../../engine/state/clientSuspended.js';
import {
  markerKind, screenAngleTo, shotMix, kickRoll, createFeelMeter,
  KICK_HEAD_RAD, KICK_KILL_RAD, KICK_MS,
} from './feel.js';

// The live game zone (one per page). portalMirror hides bot nameplates while it
// renders the main scene into the portal, through this module-level switch.
let _active = null;
export function setAllNameplatesVisible(on) { if (_active) _active.setAllNameplatesVisible(on); }

const NET_WAIT_MS = 3000;     // connected but no GZ_SNAP yet → wait this long before going local
// ADR-0133: while a multiplayer session is (re)connecting, draw NO bots rather
// than a throwaway local world that is torn down and rebuilt elsewhere a second
// later. The local sim starts only if the node has not answered in time.
export const NET_HOLD_MS = 5000;
const PREDICT_TTL_MS = 1500;  // forget an unanswered prediction after this
const BOSS_BAR_RANGE = 35;
const RETICLE_CLOSE = 0.9;    // m — "near the line of fire" for the orange reticle

/**
 * @param {object} d  injected dependencies (arenaRuntime owns them)
 * @param {THREE.Scene} d.scene
 * @param {THREE.Camera} d.camera
 * @param {THREE.Object3D} d.playerObj          eye-height player transform
 * @param {(ox,oy,oz,dx,dy,dz,max,exclude)=>any} d.castWorld   static/crate raycast
 * @param {()=>any} d.getPlayerCollider
 * @param {(crate:any, dir:THREE.Vector3, point:THREE.Vector3)=>void} [d.nudgeCrate]
 * @param {(kind:string, pos:THREE.Vector3)=>void} [d.flash]   muzzle-flash pool trigger
 * @param {()=>any} d.getMp                      multiplayer host or null
 * @param {()=>boolean} d.isKami
 * @param {object} d.hud     {flashCross, addKill, setReticleState, setBossBar, hideBossBar,
 *                            showHitMarker?, voidHitMarker?, popCombatText?, voidCombatText?,
 *                            showDamageDir?, clearCombatFeel?}  (feel: ADR-0131)
 * @param {object} d.player  {takeDamage, killPlayer, setNextSpawn, isDead}
 * @param {object} d.state   game state (kills/sats/hp)
 * @param {(name:string, p?:any)=>void} d.emit
 * @param {object} d.EV
 * @param {(level?:number, pan?:number)=>void} [d.playBotShoot]
 * @param {{hitMarker?:(zone:string)=>void, killConfirm?:(head:boolean)=>void}} [d.sfx]
 * @param {()=>number} [d.inputAt]   performance.now() of the click behind the current shot
 * @param {(id:string)=>any} [d.peerAvatar]      remote avatar object (triggerAnim)
 */
export function createGameZone(d) {
  const views = new Map();
  const fx = createGzFx(d.scene, d.camera);
  const now = () => performance.now();
  let local = null, net = null, authority = null;
  let netSince = 0, frameNo = 0, seq = 0, disposed = false, platesVisible = true;
  let holdUntil = 0;          // ADR-0133: no local sim before this (performance.now ms)
  let holds = 0, handovers = 0;
  const pending = new Map(); // seq → {id, dmg, at, zone, mk, pop}
  const feel = createFeelMeter();
  const _mix = { gain: 0, pan: 0 };
  let kickMs = -1, kickPeak = 0;
  const H = d.hud;
  const sfx = d.sfx || {};
  const rowsById = new Map(); // newest snapshot row per bot id
  const _pose = {};
  const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Vector3();
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  let lastShot = null, lastResult = null, lastMiss = null;
  const stats = { shots: 0, claims: 0, accepted: 0, rejected: 0, kills: 0, mispredicts: 0, created: 0, disposed: 0 };

  // Warm both templates immediately so the first bot draws as a model, not a capsule.
  loadBotTemplate('regular').catch(() => {});
  loadBotTemplate('boss').catch(() => {});

  // ── authority selection ────────────────────────────────────────────────────
  function _selfId() { return authority ? authority.selfId : null; }

  function _ensureLocal() {
    if (!local) local = createLocalAuthority({ onEvents: _onEvents });
    return local;
  }
  function _ensureNet(mp) {
    if (!net) {
      net = createNetAuthority({
        getSelfId: () => (mp && mp.selfId) || null,
        send: (shot) => (mp.sendGzFire ? mp.sendGzFire(shot) : false),
        onEvents: _onEvents,
      });
      netSince = now();
      // Connected but no GZ_SNAP yet: give the node NET_WAIT_MS to send one.
      holdUntil = Math.max(holdUntil, netSince + NET_WAIT_MS);
    }
    return net;
  }
  /** ADR-0133: a multiplayer (re)connect is starting — hold off the local sim. */
  function holdForNet(ms = NET_HOLD_MS) {
    if (disposed) return;
    holdUntil = Math.max(holdUntil, now() + (ms > 0 ? ms : NET_HOLD_MS));
    holds++;
  }
  function _switchTo(next) {
    if (next === authority) return;
    if (authority && next) handovers++;
    authority = next;
    // A different authority is a different world of bots: drop every view and
    // every prediction; the next reconcile builds the new roster from scratch.
    _clearViews();
    pending.clear();
  }
  function _selectAuthority() {
    const mp = d.getMp && d.getMp();
    const connected = !!(mp && mp.state === 'connected' && mp.selfId && typeof mp.sendGzFire === 'function');
    if (connected) {
      const n = _ensureNet(mp);
      if (n.ready) {
        holdUntil = 0;
        if (local) { local.dispose(); local = null; }
        _switchTo(n);
        return;
      }
      // Connected but the node has not sent a snapshot yet (or never will: an
      // older node). The hold set in _ensureNet covers the wait.
    } else if (net) {
      // Lost the node mid-game: wait for the reconnect instead of swapping in
      // a different (local) world of bots and swapping back a moment later.
      if (authority === net) holdUntil = Math.max(holdUntil, now() + NET_HOLD_MS);
      net.dispose(); net = null;
    }
    if (now() < holdUntil) {
      // Holding: an already-running local game carries on (offline play is
      // never interrupted); otherwise show no bots until the node answers.
      if (authority && authority === local) return;
      _switchTo(null);
      return;
    }
    holdUntil = 0;
    _switchTo(_ensureLocal());
  }

  // ── views ──────────────────────────────────────────────────────────────────
  function _createView(r) {
    stats.created++;
    const kind = r.kind === 1 ? 'boss' : 'regular';
    const v = createBotView(d.scene, { id: r.id, kind, name: botName(r.id, kind) });
    v.setPlatesVisible?.(platesVisible);
    return v;
  }
  function _disposeView(v) { stats.disposed++; v.dispose(); }
  function _clearViews() { clearViews(views, _disposeView); }

  function _syncViews(dt) {
    const snap = authority && authority.latest;
    if (!snap) { if (views.size) _clearViews(); return; }
    const roster = snap.b.map((r) => ({ id: r[0], kind: r[1] === 1 ? 'boss' : 'regular', row: r }));
    // reconcileViews compares view.kind with roster kind strings.
    reconcileViews(views, roster, (e) => _createView({ id: e.id, kind: e.row[1] }), _disposeView);
    rowsById.clear();
    for (const e of roster) rowsById.set(e.id, e.row);
    const hist = authority.history;
    const rt = authority.renderTick();
    for (const e of roster) {
      const v = views.get(e.id);
      const r = e.row;
      const pose = hist ? hist.sample(e.id, rt, _pose) : null;
      let st;
      if (pose) {
        v.setPose(pose.x, pose.y, pose.z, pose.yaw);
        st = pose.st;
        // Death shows as soon as the authority knows it (the newest snapshot or
        // a kill event), not 100 ms later when the delayed pose catches up — and
        // a delayed "alive" frame can never stand a dead bot back up.
        if (r[9] === pose.sp && r[7] > st) st = r[7];
        if (v.killedSp === pose.sp && st === 0) st = 1;
      } else {
        v.setPose(r[2], r[3], r[4], r[5]);
        st = r[7];
      }
      v.setLife(st);
      // hp shown = authoritative hp minus our still-unanswered predicted damage.
      let pred = 0;
      for (const p of pending.values()) if (p.id === e.id) pred += p.dmg;
      v.setHp(Math.max(0, r[6] - pred), BOT_KINDS[v.kind].hp);
      v.setAnim(r[8]);
      v.update(dt, frameNo);
    }
  }

  // ── firing ─────────────────────────────────────────────────────────────────
  function _pickBot(ox, oy, oz, dx, dy, dz, maxT) {
    let best = null;
    for (const v of views.values()) {
      const h = v.raycast(ox, oy, oz, dx, dy, dz, maxT, frameNo);
      if (h && (!best || h.t < best.t)) best = { view: v, t: h.t, zone: h.zone };
    }
    return best;
  }

  /**
   * Player fired in the arena.
   * @param {{origin:THREE.Vector3, dir:THREE.Vector3, aimOrigin?:THREE.Vector3, aimDir?:THREE.Vector3}} s
   */
  function fire(s) {
    if (disposed || !authority || !authority.ready) return;
    const ao = s.aimOrigin || s.origin;
    _d.copy(s.aimDir || s.dir);
    if (_d.lengthSq() < 1e-10) return;
    _d.normalize();
    _o.copy(ao);
    stats.shots++;

    // World occlusion (static geometry + dynamic crates; bots have no colliders).
    const wh = d.castWorld(_o.x, _o.y, _o.z, _d.x, _d.y, _d.z, FIRE_RANGE, d.getPlayerCollider());
    const maxT = wh ? wh.toi : FIRE_RANGE;
    const crate = wh ? wh.crate : null;

    const hit = _pickBot(_o.x, _o.y, _o.z, _d.x, _d.y, _d.z, maxT);
    const t = hit ? hit.t : maxT;
    _p.copy(_o).addScaledVector(_d, t);
    const my = ++seq;
    let claim = null;
    if (hit) {
      stats.claims++;
      const v = hit.view;
      const dmg = hit.zone === 'head' ? HEAD_DAMAGE : BODY_DAMAGE;
      claim = { k: 'bot', id: v.id, zone: hit.zone, dist: Math.round(hit.t * 1000) / 1000 };
      // Predict: show the hit NOW (flash + hitmarker); a lethal shot drops the
      // bot this frame. The authority's result confirms or rolls it back.
      // ADR-0134: lethal = AUTHORITATIVE hp − every unanswered shot − this one.
      // (v.hp is the displayed hp, which already has the pending damage taken
      // off; subtracting pending again predicted the boss's death far too early,
      // and a landed-but-not-lethal result then left it lying on the ground.)
      const lethal = _authHp(v) - _pendingDmg(v.id) - dmg <= 0;
      const head = hit.zone === 'head';
      // Feel (ADR-0131): marker, number, tick and reaction on the click's frame.
      // (The red full-screen vignette is for damage TAKEN only — it no longer
      // fires when you land a shot.)
      const mk = H.showHitMarker ? H.showHitMarker(markerKind(hit.zone, lethal)) : 0;
      const pop = H.popCombatText ? H.popCombatText(String(dmg), head ? 'head' : 'body') : 0;
      feel.marker();
      pending.set(my, { id: v.id, dmg, at: now(), zone: hit.zone, mk, pop });
      v.flashHit();
      H.flashCross();
      if (sfx.hitMarker) sfx.hitMarker(hit.zone);
      fx.impact(_p.x, _p.y, _p.z, true);
      if (d.flash) d.flash('botHit', _p);
      if (lethal) {
        v.predictDeath(hit.zone);
        feel.counts.kills++;
        if (sfx.killConfirm) sfx.killConfirm(head);
        _kick(head ? KICK_HEAD_RAD : KICK_KILL_RAD);
      } else {
        v.flinch(hit.zone, _d.x, _d.z);
        if (head) _kick(KICK_HEAD_RAD);
      }
    } else {
      if (wh) fx.impact(_p.x, _p.y, _p.z, false);
      if (wh && d.flash) d.flash('impact', _p);
      if (crate && d.nudgeCrate) d.nudgeCrate(crate, _d, _p);
    }
    // Tracer leaves the gun barrel, ends where the crosshair ray stopped.
    fx.tracer(s.origin.x, s.origin.y, s.origin.z, _p.x, _p.y, _p.z, TRACER_PLAYER);

    feel.shotAt(d.inputAt ? d.inputAt() : now());
    const rt = authority.renderTick();
    const shot = {
      seq: my,
      origin: [_o.x, _o.y, _o.z],
      dir: [_d.x, _d.y, _d.z],
      rt: Math.max(0, Math.round(rt * 100) / 100),
      claim,
    };
    lastShot = { ...shot, at: Date.now(), authority: authority.kind, worldHit: wh ? { toi: wh.toi, crate: !!crate } : null };
    if (!hit) lastMiss = lastShot;
    authority.fire(shot);
  }

  // ── authority events ───────────────────────────────────────────────────────
  function _onEvents(evs) {
    const self = _selfId();
    for (const e of evs) {
      switch (e.type) {
        case 'result': if (e.sid === self) _onResult(e); break;
        case 'hit': _onHit(e, self); break;
        case 'kill': _onKill(e, self); break;
        case 'shot': _onShot(e, self); break;
        case 'respawn':
          if (e.pid === self && authority && authority.kind === 'local' && Array.isArray(e.pos)) {
            d.player.setNextSpawn(e.pos[0], e.pos[2], e.yaw || 0);
          }
          break;
        default: break;
      }
    }
  }

  function _pendingDmg(id) {
    let n = 0;
    for (const q of pending.values()) if (q.id === id) n += q.dmg;
    return n;
  }
  function _authHp(v) {
    const r = rowsById.get(v.id);
    return r ? r[6] : v.hp + _pendingDmg(v.id);
  }
  /** A predicted death that the authority did not confirm must stand back up. */
  function _settlePrediction(v, authHp) {
    if (!v || !v.predictedDead || v.life !== 0) return;
    if (authHp - _pendingDmg(v.id) > 0) { v.cancelPredictedDeath(); stats.mispredicts++; }
  }

  function _onResult(e) {
    const p = pending.get(e.seq);
    pending.delete(e.seq);
    lastResult = { ...e, at: Date.now() };
    if (e.ok) stats.accepted++; else stats.rejected++;
    if (!p) return;
    const v = views.get(p.id);
    const landed = e.ok && e.hit && e.hit.tk === 'bot' && e.hit.tid === p.id && !e.hit.absorbed;
    if (!landed) {
      // Take the feedback back: the marker and number were a prediction.
      if (H.voidHitMarker) H.voidHitMarker(p.mk);
      if (H.voidCombatText) H.voidCombatText(p.pop);
      feel.voided();
    } else if (e.hit.zone !== p.zone && H.voidCombatText && H.popCombatText) {
      // Authority downgraded the zone (head → body): show the damage it applied.
      H.voidCombatText(p.pop);
      H.popCombatText(String(e.hit.dmg), e.hit.zone === 'head' ? 'head' : 'body');
    }
    if (!v) return;
    // Landed but not lethal (zone downgraded, boss hp, other shooters), or not
    // landed at all: stand the bot back up unless what is still pending kills it.
    if (v.predictedDead && !(landed && e.hit.killed)) {
      _settlePrediction(v, landed && Number.isFinite(e.hit.hp) ? e.hit.hp : _authHp(v));
    }
  }

  function _onHit(e, self) {
    if (e.tk === 'bot') {
      const v = views.get(e.tid);
      if (v) {
        if (e.sid !== self) {
          v.flashHit();
          const src = _sourcePos(e.sk, e.sid);
          if (src) v.flinch(e.zone, v.holder.position.x - src.x, v.holder.position.z - src.z);
        }
        v.setHp(e.hp, BOT_KINDS[v.kind].hp);
      }
      return;
    }
    if (e.tk === 'player') {
      if (e.tid === self) {
        const before = d.state.hp;
        d.player.takeDamage(e.dmg);
        // Damage-direction arc — only when the hit actually cost hp (not in
        // god/Kami mode), pointing at whoever fired.
        const src = d.state.hp < before ? _sourcePos(e.sk, e.sid) : null;
        if (src && H.showDamageDir) {
          const pp = d.playerObj.position;
          H.showDamageDir(screenAngleTo(pp.x, pp.z, d.playerObj.rotation.y, src.x, src.z), e.dmg / 25);
          feel.counts.damageArcs++;
        }
      } else {
        const a = d.peerAvatar && d.peerAvatar(e.tid);
        if (a && a.triggerAnim) a.triggerAnim('hit');
      }
    }
  }

  function _onKill(e, self) {
    if (e.tk === 'bot') {
      const v = views.get(e.tid);
      const wasPredicted = !!(v && v.predictedDead);
      if (v) {
        const r = rowsById.get(e.tid);
        v.killedSp = r ? r[9] : -1;
        if (e.zone) v.noteZone(e.zone);
        v.setLife(1);
      }
      if (e.sid === self) {
        stats.kills++;
        feel.counts.killsConfirmed++;
        // Unpredicted kill (e.g. the prediction was conservative): confirm now.
        if (!wasPredicted) {
          if (sfx.killConfirm) sfx.killConfirm(e.zone === 'head');
          if (H.showHitMarker) H.showHitMarker(markerKind(e.zone, true));
        }
        // The reward pops only once the authority has actually paid it.
        if (H.popCombatText) H.popCombatText(`+${KILL_SATS}⚡`, 'reward');
        d.state.kills++;
        d.state.sats += KILL_SATS;
        d.emit(d.EV.BOT_KILLED, { sats: KILL_SATS, zone: e.zone });
        d.emit(d.EV.HUD_UPDATE);
      }
      return;
    }
    if (e.tk === 'player') {
      if (e.tid === self) {
        // Multiplayer: the VPS is the authority. Single-player: the local sim
        // agrees with the client's hp unless god mode is on — respect it.
        if (authority && (authority.kind === 'net' || d.state.hp <= 0)) d.player.killPlayer();
      } else {
        const a = d.peerAvatar && d.peerAvatar(e.tid);
        if (a && a.triggerAnim) a.triggerAnim('death');
      }
      if (e.sid === self && e.tid !== self) { d.state.kills++; d.hud.addKill('Fragged a rival'); d.emit(d.EV.HUD_UPDATE); }
    }
  }

  function _onShot(e, self) {
    // ADR-0098: after Home the socket stays open but our client is suspended —
    // relayed shots must neither draw nor sound.
    if (isClientSuspended()) return;
    if (!Array.isArray(e.from) || !Array.isArray(e.to)) return;
    if (e.sk === 'player' && e.sid === self) return; // already drawn at fire time
    _a.set(e.from[0], e.from[1], e.from[2]);
    _b.set(e.to[0], e.to[1], e.to[2]);
    fx.tracer(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, e.sk === 'bot' ? TRACER_BOT : TRACER_PEER);
    if (d.flash) d.flash('muzzle', _a);
    if (e.sk === 'bot') {
      if (d.playBotShoot) {
        const pp = d.playerObj.position;
        shotMix(pp.x, pp.z, d.playerObj.rotation.y, e.from[0], e.from[2], _mix);
        if (_mix.gain > 0) d.playBotShoot(_mix.gain, _mix.pan);
      }
    }
    else {
      const av = d.peerAvatar && d.peerAvatar(e.sid);
      if (av && av.triggerAnim) av.triggerAnim('shoot');
    }
  }

  /** World position of a shooter (bot view or peer avatar), or null. */
  function _sourcePos(sk, sid) {
    if (sk === 'bot') { const v = views.get(sid); return v ? v.holder.position : null; }
    const a = d.peerAvatar && d.peerAvatar(sid);
    return a && a.position ? a.position : null;
  }

  /** Screen kick: camera ROLL only, so the aim line (crosshair) never moves. */
  function _kick(peak) {
    if (!d.camera) return;
    const live = kickMs >= 0 && kickMs < KICK_MS ? kickPeak : 0;
    kickMs = 0; kickPeak = Math.max(live, peak);
  }
  function _tickKick(dt) {
    if (kickMs < 0 || !d.camera) return;
    kickMs += dt * 1000;
    if (kickMs >= KICK_MS) { kickMs = -1; kickPeak = 0; d.camera.rotation.z = 0; return; }
    d.camera.rotation.z = kickRoll(kickMs, kickPeak);
  }

  // ── per-frame HUD: reticle + boss bar ──────────────────────────────────────
  function _reticle() {
    d.camera.getWorldPosition(_o);
    d.camera.getWorldDirection(_d);
    const wh = d.castWorld(_o.x, _o.y, _o.z, _d.x, _d.y, _d.z, FIRE_RANGE, d.getPlayerCollider());
    const maxT = wh ? wh.toi : FIRE_RANGE;
    const hit = _pickBot(_o.x, _o.y, _o.z, _d.x, _d.y, _d.z, maxT);
    if (hit) { d.hud.setReticleState(hit.zone === 'head' ? 'headshot' : 'on'); return; }
    for (const v of views.values()) {
      if (!v.hittable) continue;
      v.headWorld(_q);
      _q.y -= v.spec.height * 0.4;
      const along = _p.copy(_q).sub(_o).dot(_d);
      if (along <= 0 || along > maxT) continue;
      _p.copy(_o).addScaledVector(_d, along);
      if (_p.distanceTo(_q) < RETICLE_CLOSE + v.spec.radius) { d.hud.setReticleState('close'); return; }
    }
    d.hud.setReticleState('none');
  }

  function _bossBar() {
    let boss = null, bd = Infinity;
    const pp = d.playerObj.position;
    for (const v of views.values()) {
      if (v.kind !== 'boss' || v.life !== 0) continue;
      const dist = Math.hypot(v.holder.position.x - pp.x, v.holder.position.z - pp.z);
      if (dist < bd) { bd = dist; boss = v; }
    }
    if (!boss || bd > BOSS_BAR_RANGE) { d.hud.hideBossBar(); return; }
    boss.headWorld(_q);
    _q.y += 0.6;
    _q.project(d.camera);
    const onScreen = _q.z < 1 && Math.abs(_q.x) < 1.05 && Math.abs(_q.y) < 1.05;
    const w = typeof innerWidth === 'number' ? innerWidth : 1, h = typeof innerHeight === 'number' ? innerHeight : 1;
    d.hud.setBossBar({
      id: boss.id, name: boss.name, hp: boss.hp, maxHp: boss.maxHp, alive: !boss.predictedDead,
      screenX: (_q.x * 0.5 + 0.5) * w, screenY: (-_q.y * 0.5 + 0.5) * h, anchored: onScreen,
    });
  }

  /**
   * Once per rendered frame (arena only, not minimal world).
   * @param {number} dt seconds
   * @param {{playing:boolean}} ctx
   */
  function frame(dt, ctx = {}) {
    if (disposed) return;
    feel.frameAt(now());
    frameNo++;
    _selectAuthority();
    if (authority && authority.kind === 'local') {
      const pp = d.playerObj.position;
      authority.frame(dt * 1000, {
        pos: [pp.x, pp.y, pp.z], yaw: d.playerObj.rotation.y,
        targetable: !d.isKami() && !d.player.isDead(),
      });
    }
    // Expire predictions the authority never answered (dropped packet).
    if (pending.size) {
      const t = now();
      for (const [k, p] of pending) {
        if (t - p.at > PREDICT_TTL_MS) {
          pending.delete(k);
          const v = views.get(p.id);
          if (v && v.predictedDead) { v.cancelPredictedDeath(); stats.mispredicts++; }
        }
      }
    }
    // Safety net (ADR-0134): a predicted death with nothing left pending and no
    // kill from the authority stands back up — a bot is never left lying alive.
    if (frameNo % 15 === 0) {
      for (const v of views.values()) {
        if (v.predictedDead && v.life === 0 && _pendingDmg(v.id) === 0) {
          if (!v._pdAt) v._pdAt = now();
          else if (now() - v._pdAt > PREDICT_TTL_MS) { v._pdAt = 0; _settlePrediction(v, _authHp(v)); }
        } else if (v._pdAt) v._pdAt = 0;
      }
    }
    _syncViews(dt);
    fx.tick(dt * fxScale);
    _tickKick(dt);
    if (ctx.playing !== false) { _reticle(); _bossBar(); }
  }

  /** Drop every bot view + effect (world rebuild). The authority keeps running. */
  function clear() {
    _clearViews(); pending.clear(); fx.clear(); d.hud.hideBossBar(); d.hud.setReticleState('none');
    if (H.clearCombatFeel) H.clearCombatFeel();
    if (kickMs >= 0 && d.camera) d.camera.rotation.z = 0;
    kickMs = -1; kickPeak = 0;
  }

  function dispose() {
    if (disposed) return;
    clear();
    disposed = true;
    if (local) local.dispose();
    if (net) net.dispose();
    local = net = authority = null;
    fx.dispose();
    if (_active === api) _active = null;
  }

  // ── network ingress (arenaRuntime routes mp_gzSnap / mp_gzEvent here) ──────
  function ingestSnapshot(m) { const mp = d.getMp && d.getMp(); if (mp) _ensureNet(mp).ingestSnapshot(m); }
  function ingestEvents(m) { if (net) net.ingestEvents(m); }

  function setAllNameplatesVisible(on) {
    platesVisible = !!on;
    for (const v of views.values()) v.setPlatesVisible?.(platesVisible);
  }

  // ── debug surface (ToriiDebug.gz) ──────────────────────────────────────────
  function debug() {
    return {
      authority: authority ? authority.kind : null,
      ready: !!(authority && authority.ready),
      holding: !authority && now() < holdUntil, holds, handovers,
      selfId: _selfId(),
      tick: authority && authority.latest ? authority.latest.tick : null,
      renderTick: authority ? Math.round(authority.renderTick() * 100) / 100 : null,
      views: views.size,
      pending: pending.size,
      stats: { ...stats },
      feel: feel.stats(),
      fx: fx.active,
      lastShot, lastResult, lastMiss,
    };
  }
  function list() {
    return Array.from(views.values()).map((v) => ({
      id: v.id, kind: v.kind, name: v.name, hp: v.hp, maxHp: v.maxHp, life: v.life,
      predictedDead: v.predictedDead, modelReady: v.modelReady,
      x: Math.round(v.holder.position.x * 100) / 100, y: Math.round(v.holder.position.y * 100) / 100, z: Math.round(v.holder.position.z * 100) / 100,
      visible: v.holder.visible,
    }));
  }
  /** Debug-only: damage bot `id` through the local sim (single-player only). */
  // Debug seam (ADR-0136): slow effects down so tracers can be inspected/captured.
  let fxScale = 1;
  function setFxTimeScale(k) { fxScale = Number.isFinite(k) ? Math.max(0, Math.min(1, k)) : 1; return fxScale; }

  function debugDamage(id, n = 3) {
    if (!authority || authority.kind !== 'local' || !authority.sim) return false;
    return authority.sim.debugDamage ? authority.sim.debugDamage(id, n, LOCAL_ID) : false;
  }

  const api = {
    fire, frame, clear, dispose, ingestSnapshot, ingestEvents, setAllNameplatesVisible, holdForNet,
    debug, list, debugDamage, setFxTimeScale,
    resetFeelStats() { feel.reset(); },
    alivePositions() {
      const out = [];
      for (const v of views.values()) if (v.life === 0) out.push({ x: v.holder.position.x, z: v.holder.position.z });
      return out;
    },
    get count() { return views.size; },
    get views() { return views; },
    get authority() { return authority; },
  };
  _active = api;
  return api;
}
