// Lifecycle contract for pluggable game modes.

export const GAME_MODE_HOOKS = Object.freeze([
  'init',
  'tick',
  'dispose',
  'onPlayerJoin',
  'onPlayerLeave',
  'onPlayerDeath',
  'onPlayerRespawn',
  'onBotKilled',
]);

const noop = () => {};

export function createGameMode(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new TypeError('Game mode definition must be an object');
  }
  if (typeof definition.init !== 'function' && typeof definition.tick !== 'function') {
    throw new TypeError('Game mode definition must provide init or tick');
  }

  const mode = {};
  Object.defineProperties(mode, Object.getOwnPropertyDescriptors(definition));
  for (const hook of GAME_MODE_HOOKS) {
    if (mode[hook] === undefined) mode[hook] = noop;
    else if (typeof mode[hook] !== 'function') {
      throw new TypeError(`Game mode hook "${hook}" must be a function`);
    }
  }
  return Object.freeze(mode);
}
