// Phase 1 bridge from a validated world definition to existing constant names.
// Existing game modules continue to import src/config.js until Phase 2.

import { DEFAULT_WORLD, validateWorld } from './worldLoader.js';

// Constants outside the Phase 1 world schema remain sourced from config.js.
// This keeps worldConfig.js import-compatible while world-owned values below
// come from a loaded and validated world definition.
export {
  VERSION,
  GAME_NAME,
  EAST_GAP_HALF,
  BRIDGE_DECK_Y,
  BRIDGE_LEN,
  BRIDGE_WIDTH,
  BRIDGE_THICK,
  PLAYER_HP,
  PLAYER_SPEED,
  PLAYER_RADIUS,
  JUMP_FORCE,
  GRAVITY,
  BOSS_NAME,
  MAX_AMMO,
  RELOAD_TIME,
  SHOOT_CD,
  BULLET_SPEED,
  BULLET_LIFE,
  ENTRY_SATS,
  RESPAWN_TIME,
  godMode,
  SCORE_PUBLISH_ENABLED,
  MP_ENABLED,
  MP_WS_PATH,
  ADMIN_NPUB,
  ADMIN_PUBKEY_HEX,
  TUNING,
  CRATES,
  OBSTACLES,
} from '../../config.js';

function objectByType(objects, type) {
  return objects.find((object) => object.type === type);
}

export function createWorldConfig(world = DEFAULT_WORLD) {
  const validation = validateWorld(world);
  if (!validation.ok) {
    throw new Error(`Invalid world config: ${validation.errors.join('; ')}`);
  }

  const { bounds, combat, objects, spawns, terrain } = validation.data;
  const travelGate = objectByType(objects, 'travel-gate');
  const tree = objectByType(objects, 'tree');
  const bridge = objectByType(objects, 'bridge');

  return Object.freeze({
    ARENA_HALF: bounds.arenaHalf,
    WALL_H: bounds.wallH,
    WALL_WALL_H: bounds.wallWallH,
    NAP_X: bounds.napX,
    NAP_FAR_X: bounds.napFarX,
    TRAVEL_GATE_X: travelGate.pos[0],
    TRAVEL_GATE_Z: travelGate.pos[2],
    TRAVEL_GATE_YAW_DELTA: travelGate.rot,
    NAP_SPAWN_X: spawns.nap.x,
    NAP_SPAWN_Z: spawns.nap.z,
    NAP_SPAWN_YAW: spawns.nap.yaw,
    NAP_TREE_X: tree.pos[0],
    NAP_TREE_Z: tree.pos[2],
    BRIDGE_X: bridge.pos[0],
    BRIDGE_Z: bridge.pos[2],
    BOT_COUNT: combat.botCount,
    BOT_HP: combat.botHp,
    BOT_SPEED: combat.botSpeed,
    BOT_SHOOT_CD: combat.botShootCd,
    BOT_SIGHT: combat.botSight,
    BOT_DAMAGE: combat.botDamage,
    BOT_SPREAD: combat.botSpread,
    BOT_BODY_RADIUS: combat.botBodyRadius,
    BOT_HEAD_RADIUS: combat.botHeadRadius,
    BOSS_COUNT: combat.bossCount,
    BOSS_HP: combat.bossHp,
    BOSS_SPEED: combat.bossSpeed,
    BOSS_DAMAGE: combat.bossDamage,
    BOSS_SHOOT_CD: combat.bossShootCd,
    BOSS_RADIUS: combat.bossRadius,
    BOSS_TARGET_HEIGHT: combat.bossTargetHeight,
    BODY_DAMAGE: combat.bodyDamage,
    HEADSHOT_DAMAGE: combat.headshotDamage,
    LAG_COMP_MS: combat.lagCompMs,
    ISLAND_BASE_Y: terrain.arena.islandBaseY,
    SEA_LEVEL: terrain.seaLevel,
  });
}

export const WORLD_CONFIG = createWorldConfig();

export const {
  ARENA_HALF,
  WALL_H,
  WALL_WALL_H,
  NAP_X,
  NAP_FAR_X,
  TRAVEL_GATE_X,
  TRAVEL_GATE_Z,
  TRAVEL_GATE_YAW_DELTA,
  NAP_SPAWN_X,
  NAP_SPAWN_Z,
  NAP_SPAWN_YAW,
  NAP_TREE_X,
  NAP_TREE_Z,
  BRIDGE_X,
  BRIDGE_Z,
  BOT_COUNT,
  BOT_HP,
  BOT_SPEED,
  BOT_SHOOT_CD,
  BOT_SIGHT,
  BOT_DAMAGE,
  BOT_SPREAD,
  BOT_BODY_RADIUS,
  BOT_HEAD_RADIUS,
  BOSS_COUNT,
  BOSS_HP,
  BOSS_SPEED,
  BOSS_DAMAGE,
  BOSS_SHOOT_CD,
  BOSS_RADIUS,
  BOSS_TARGET_HEIGHT,
  BODY_DAMAGE,
  HEADSHOT_DAMAGE,
  LAG_COMP_MS,
  ISLAND_BASE_Y,
  SEA_LEVEL,
} = WORLD_CONFIG;
