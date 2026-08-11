// Torii Quest's arena combat mode. Heavy THREE-dependent gameplay modules are
// loaded only when init() runs, preserving the title screen's deferred bundle.
import { createGameMode } from './gameMode.js';

export function createArenaShooterMode() {
  let context = null;
  let api = null;
  let disposed = false;
  const subscriptions = [];

  const subscribe = (event, handler) => {
    api.on(event, handler);
    subscriptions.push([event, handler]);
  };

  const multiplayerHost = () => context?.getMultiplayerHost?.() || context?.mp || null;

  const mode = createGameMode({
    id: 'arena-shooter',

    async init(nextContext) {
      if (context) return mode.getState();
      context = nextContext;
      disposed = false;

      const [botsModule, weaponsModule, playerModule, eventsModule, hudModule, audioModule, stateModule] =
        await Promise.all([
          import('../../bots.js'),
          import('../../weapons.js'),
          import('../../player.js'),
          import('../../events.js'),
          import('../../hud.js'),
          import('../../audio.js'),
          import('../../state.js'),
        ]);

      api = {
        ...botsModule,
        ...weaponsModule,
        ...playerModule,
        ...eventsModule,
        ...hudModule,
        ...audioModule,
        ...stateModule,
      };

      api.initBots(api.playerObj, api.spawnBullet);
      api.initWeapons(
        api.bots,
        api.takeDamage,
        api.getPlayerCollider,
        api.isBotNetMode,
        (impactPos) => context.muzzleFlashes?.trigger('impact', impactPos),
      );

      subscribe(api.EV.SHOOT, ({ origin, dir, aimOrigin, aimDir }) => {
        if (api.playerObj.position.x > context.napX) return;
        const bullet = api.spawnBullet(origin, dir, true);
        context.muzzleFlashes?.trigger('muzzle', origin);
        if (aimOrigin && aimDir) {
          api.recordPlayerShot(
            bullet,
            aimOrigin.x, aimOrigin.y, aimOrigin.z,
            aimDir.x, aimDir.y, aimDir.z,
          );
        }
        api.triggerRecoil();
        api.playShoot();
        context.onPlayerShot?.({ origin, dir, aimOrigin, aimDir });
      });
      subscribe(api.EV.SHOOT, () => context.onShootAnimation?.());
      subscribe(api.EV.BOT_HIT_BY_PLAYER, ({ bot, dmg }) => {
        api.hitBot(bot, dmg);
        if (bot?.pos) context.muzzleFlashes?.trigger('botHit', bot.pos);
        api.flashCross();
      });
      subscribe(api.EV.PLAYER_KILLED, () => {
        const best = api.pickRespawnCorner(
          api.bots.filter((bot) => bot.alive).map((bot) => bot.pos),
        );
        api.setNextSpawn(best.x, best.z, best.yaw);
        mode.onPlayerDeath(api.playerObj);
      });
      subscribe(api.EV.PLAYER_RESPAWN, () => mode.onPlayerRespawn(api.playerObj));
      subscribe(api.EV.BOT_KILLED, (payload) => mode.onBotKilled(payload?.bot, api.playerObj));

      // Compatibility bridge used by the weapon hit path.
      globalThis._onBotHit = (bot, dmg) => api.emit(api.EV.BOT_HIT_BY_PLAYER, { bot, dmg });
      return mode.getState();
    },

    tick(dt) {
      if (!api || disposed) return;
      api.tickDeath(dt, context.renderer);
      api.tickBots(dt);
      if (context.isPlaying()) {
        context.stepPhysics();
        context.tickDynamicCrates();
      }
      api.tickWeapons(dt, api.playerObj.position);
    },

    dispose() {
      if (!api || disposed) return;
      disposed = true;
      for (const [event, handler] of subscriptions.splice(0)) api.off(event, handler);
      if (globalThis._onBotHit) delete globalThis._onBotHit;
      api.setBotNetMode(false);
      context = null;
    },

    onPlayerDeath() {
      context?.onPlayerDeath?.();
    },

    onPlayerJoin(player) {
      context?.onPlayerJoin?.(player);
    },

    onPlayerLeave(player) {
      context?.onPlayerLeave?.(player);
    },

    onPlayerRespawn(player) {
      context?.onPlayerRespawn?.(player);
    },

    onBotKilled(bot, killer) {
      context?.onBotKilled?.(bot, killer);
    },

    getState() {
      return {
        bots: api?.bots || [],
        bullets: api?.bullets || [],
        score: api ? { kills: api.state.kills, sats: api.state.sats } : { kills: 0, sats: 0 },
      };
    },

    get bots() {
      return api?.bots || [];
    },

    getLastHit: () => api?.getLastHit?.(),
    getLastShot: () => api?.getLastShot?.(),
    getLastMiss: () => api?.getLastMiss?.(),
    hitBot: (bot, damage) => api?.hitBot?.(bot, damage),
    isBotNetMode: () => api?.isBotNetMode?.() || false,
    setBotNetMode: (enabled) => api?.setBotNetMode?.(enabled),
    ingestBotState: (states) => api?.ingestBotState?.(states),
    applyBotShot: (origin, direction) => api?.applyBotShot?.(origin, direction),
    applyBotHit: (botId, hp) => api?.applyBotHit?.(botId, hp),
    applyBotKill: (botId) => api?.applyBotKill?.(botId),
    takeDamage: (damage) => api?.takeDamage?.(damage),
    killPlayer: () => api?.killPlayer?.(),

    handleMultiplayerEvent(name, payload = {}) {
      if (!api) return false;
      const selfId = multiplayerHost()?.selfId;
      if (name === 'mp_peerJoin') {
        mode.onPlayerJoin(payload);
        return true;
      }
      if (name === 'mp_peerLeft') {
        mode.onPlayerLeave(payload);
        return true;
      }
      if (name === 'mp_roster') {
        for (const player of payload.roster || []) mode.onPlayerJoin(player);
        return true;
      }
      if (name === 'mp_state') {
        if (payload.state === context.wsState.CONNECTED) {
          api.setBotNetMode(true);
          mode.onPlayerJoin({ id: payload.selfId, self: true });
        } else if (payload.state === context.wsState.CLOSED) {
          api.setBotNetMode(false);
          mode.onPlayerLeave({ id: payload.selfId, self: true });
        }
        return true;
      }
      if (name === 'mp_stopped' || name === 'mp_disabled') {
        api.setBotNetMode(false);
        return true;
      }
      if (name === 'mp_score') {
        context.onScoreFrame?.(payload);
        return true;
      }
      if (name === 'mp_botState') {
        api.ingestBotState(payload.bots);
        return true;
      }
      if (name === 'mp_botShot') {
        context.onBotShot?.(payload);
        api.applyBotShot(payload.origin, payload.dir);
        return true;
      }
      if (name === 'mp_botHit') {
        api.applyBotHit(payload.botId, payload.hp);
        if (selfId && payload.shooterId === selfId) {
          const bot = api.bots.find((entry) => entry.state?.id === payload.botId);
          if (bot) context.muzzleFlashes?.trigger('botHit', bot.pos);
          api.flashCross();
        }
        return true;
      }
      if (name === 'mp_botKill') {
        api.applyBotKill(payload.botId);
        if (selfId && payload.shooterId === selfId) {
          api.state.kills++;
          api.state.sats += 5;
          api.emit(api.EV.BOT_KILLED, { sats: 5 });
          api.emit(api.EV.HUD_UPDATE);
        }
        return true;
      }
      if (name === 'mp_respawn') {
        if (!Array.isArray(payload.pos)) return true;
        const yaw = Array.isArray(payload.rot) ? payload.rot[0] : 0;
        api.setNextSpawn(payload.pos[0], payload.pos[2], yaw);
        api.resetPlayerPos();
        api.state.hp = typeof payload.hp === 'number' ? payload.hp : context.playerHp;
        api.emit(api.EV.HUD_UPDATE);
        return true;
      }
      return false;
    },
  });

  return mode;
}

export const arenaShooterMode = createArenaShooterMode();
