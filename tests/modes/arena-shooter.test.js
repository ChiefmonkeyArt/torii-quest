import { describe, expect, it } from 'vitest';

import {
  createGameMode,
  GAME_MODE_HOOKS,
} from '../../src/engine/modes/gameMode.js';
import {
  arenaShooterMode,
  createArenaShooterMode,
} from '../../src/engine/modes/arena-shooter.js';

describe('game mode contract', () => {
  it('validates the definition', () => {
    expect(() => createGameMode()).toThrow(/definition must be an object/i);
    expect(() => createGameMode({ name: 'empty' })).toThrow(/provide init or tick/i);
    expect(() => createGameMode({ tick: true })).toThrow(/provide init or tick/i);
    expect(() => createGameMode({ tick() {}, dispose: true })).toThrow(/dispose.*function/i);
  });

  it('freezes a mode with every lifecycle hook defaulted to a no-op', () => {
    const mode = createGameMode({ tick() {} });
    expect(Object.isFrozen(mode)).toBe(true);
    for (const hook of GAME_MODE_HOOKS) expect(mode[hook]).toBeTypeOf('function');
    expect(mode.dispose()).toBeUndefined();
  });

  it('arena-shooter exports valid game mode objects', () => {
    expect(arenaShooterMode.id).toBe('arena-shooter');
    expect(Object.isFrozen(arenaShooterMode)).toBe(true);
    const freshMode = createArenaShooterMode();
    for (const hook of GAME_MODE_HOOKS) expect(freshMode[hook]).toBeTypeOf('function');
    expect(freshMode.getState()).toEqual({
      bots: [],
      bullets: [],
      score: { kills: 0, sats: 0 },
    });
  });
});
