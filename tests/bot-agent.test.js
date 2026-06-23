// tests/bot-agent.test.js — locks down the pure BotAgent decision helpers
// (engine/entities/bot-agent.js) against the behaviour previously inlined in
// src/bots.js's tickBots(). Pure logic: no Three/Rapier/browser needed.
import { describe, it, expect } from 'vitest';
import {
  engageSpeed, steerComponent, inEngageRange, wantsToShoot, decideActions,
  BOT_ACTION, NEAR_DIST, NEAR_SPEED_SCALE, SEEK_WEIGHT, SEP_WEIGHT,
} from '../src/engine/entities/bot-agent.js';
import { BOT_SPEED, BOT_SIGHT } from '../src/config.js';

describe('engageSpeed', () => {
  it('runs at full speed beyond NEAR_DIST', () => {
    expect(engageSpeed(NEAR_DIST + 0.01)).toBeCloseTo(BOT_SPEED, 12);
    expect(engageSpeed(100)).toBeCloseTo(BOT_SPEED, 12);
  });
  it('slows down at or within NEAR_DIST', () => {
    expect(engageSpeed(NEAR_DIST)).toBeCloseTo(BOT_SPEED * NEAR_SPEED_SCALE, 12);
    expect(engageSpeed(0)).toBeCloseTo(BOT_SPEED * NEAR_SPEED_SCALE, 12);
  });
});

describe('steerComponent', () => {
  it('blends seek and separation by their weights', () => {
    expect(steerComponent(1, 0)).toBeCloseTo(SEEK_WEIGHT, 12);
    expect(steerComponent(0, 1)).toBeCloseTo(SEP_WEIGHT, 12);
    expect(steerComponent(1, 1)).toBeCloseTo(SEEK_WEIGHT + SEP_WEIGHT, 12);
  });
  it('matches the prior inline 0.7/0.3 blend', () => {
    expect(steerComponent(0.5, -0.2)).toBeCloseTo(0.5 * 0.7 + -0.2 * 0.3, 12);
  });
});

describe('inEngageRange', () => {
  it('is true only inside sight range and outside the NAP zone', () => {
    expect(inEngageRange(BOT_SIGHT - 1, false)).toBe(true);
    expect(inEngageRange(BOT_SIGHT, false)).toBe(false);   // strict <
    expect(inEngageRange(BOT_SIGHT + 1, false)).toBe(false);
    expect(inEngageRange(BOT_SIGHT - 1, true)).toBe(false); // player in NAP
  });
});

describe('wantsToShoot', () => {
  it('requires range AND line of sight', () => {
    expect(wantsToShoot(BOT_SIGHT - 1, false, true)).toBe(true);
    expect(wantsToShoot(BOT_SIGHT - 1, false, false)).toBe(false); // blocked LOS
    expect(wantsToShoot(BOT_SIGHT + 1, false, true)).toBe(false);  // out of range
    expect(wantsToShoot(BOT_SIGHT - 1, true, true)).toBe(false);   // NAP truce
  });
});

describe('decideActions', () => {
  it('idles when dead', () => {
    const a = decideActions({ alive: false, dist: 1, playerInNap: false, hasLOS: true, shootReady: true });
    expect(a).toEqual([{ type: BOT_ACTION.IDLE }]);
  });
  it('moves but does not shoot when out of range', () => {
    const a = decideActions({ alive: true, dist: BOT_SIGHT + 5, playerInNap: false, hasLOS: true, shootReady: true });
    expect(a).toEqual([{ type: BOT_ACTION.MOVE }]);
  });
  it('moves and shoots when in range, LOS clear and cooldown ready', () => {
    const a = decideActions({ alive: true, dist: 2, playerInNap: false, hasLOS: true, shootReady: true });
    expect(a).toEqual([{ type: BOT_ACTION.MOVE }, { type: BOT_ACTION.SHOOT }]);
  });
  it('moves but holds fire when cooldown is not ready', () => {
    const a = decideActions({ alive: true, dist: 2, playerInNap: false, hasLOS: true, shootReady: false });
    expect(a).toEqual([{ type: BOT_ACTION.MOVE }]);
  });
  it('moves but holds fire when LOS is blocked', () => {
    const a = decideActions({ alive: true, dist: 2, playerInNap: false, hasLOS: false, shootReady: true });
    expect(a).toEqual([{ type: BOT_ACTION.MOVE }]);
  });
});
