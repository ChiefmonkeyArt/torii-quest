// tests/classifier.test.js — locks down the shared headshot classifier
// (engine/combat/classifier.js) against the known bot head-sphere geometry.
// Pure logic: no Three/Rapier/browser needed.
import { describe, it, expect } from 'vitest';
import {
  isInHeadSphere, classifyHeadshot,
  HEAD_BOTTOM, HEAD_PROX, HEAD_PROX_SQ,
} from '../src/engine/combat/classifier.js';
import {
  BOT_HEAD_CENTRE_Y_OFFSET, BOT_HEAD_RADIUS,
} from '../src/engine/physics/bodies.js';

// A bot stood at the origin, foot on the floor (y=0 alive).
const bot = { pos: { x: 0, y: 0, z: 0 } };
const HEAD_Y = BOT_HEAD_CENTRE_Y_OFFSET; // 1.65 — head centre above the foot

describe('head-sphere geometry constants', () => {
  it('derives the proximity backstop from the head radius', () => {
    expect(HEAD_PROX).toBeCloseTo(BOT_HEAD_RADIUS + 0.05, 12);
    expect(HEAD_PROX_SQ).toBeCloseTo(HEAD_PROX * HEAD_PROX, 12);
  });
  it('puts the neck line at head centre minus radius', () => {
    expect(HEAD_BOTTOM).toBeCloseTo(BOT_HEAD_CENTRE_Y_OFFSET - BOT_HEAD_RADIUS, 12);
  });
});

describe('isInHeadSphere', () => {
  it('true at the exact head centre', () => {
    expect(isInHeadSphere(0, HEAD_Y, 0, bot)).toBe(true);
  });
  it('true just inside the proximity radius (horizontal)', () => {
    expect(isInHeadSphere(HEAD_PROX - 0.001, HEAD_Y, 0, bot)).toBe(true);
  });
  it('false just outside the proximity radius (horizontal)', () => {
    expect(isInHeadSphere(HEAD_PROX + 0.001, HEAD_Y, 0, bot)).toBe(false);
  });
  it('false at a body/torso impact well below the head', () => {
    expect(isInHeadSphere(0, 0.9, 0, bot)).toBe(false);
  });
  it('false at the feet', () => {
    expect(isInHeadSphere(0, 0, 0, bot)).toBe(false);
  });
  it('tracks the bot position offset', () => {
    const offset = { pos: { x: 5, y: 0, z: -3 } };
    expect(isInHeadSphere(5, HEAD_Y, -3, offset)).toBe(true);
    expect(isInHeadSphere(0, HEAD_Y, 0, offset)).toBe(false);
  });
  it('accounts for a raised foot (y > 0)', () => {
    const airborne = { pos: { x: 0, y: 2, z: 0 } };
    // head centre is now foot(2) + offset
    expect(isInHeadSphere(0, 2 + HEAD_Y, 0, airborne)).toBe(true);
    expect(isInHeadSphere(0, HEAD_Y, 0, airborne)).toBe(false);
  });
  it('treats a bot without pos as origin-based', () => {
    expect(isInHeadSphere(0, HEAD_Y, 0, {})).toBe(true);
  });
});

describe('classifyHeadshot', () => {
  it('is a headshot when the ray resolved the head collider outright', () => {
    // body-part === 'head' wins even if the impact point is at the feet.
    expect(classifyHeadshot(0, 0, 0, 'head', bot)).toBe(true);
  });
  it('is a headshot when a body-classified impact lies inside the head sphere', () => {
    // proximity backstop: bodyPart 'body' but point inside sphere → headshot
    expect(classifyHeadshot(0, HEAD_Y, 0, 'body', bot)).toBe(true);
  });
  it('is NOT a headshot for a torso impact classified as body', () => {
    expect(classifyHeadshot(0, 0.9, 0, 'body', bot)).toBe(false);
  });
  it('does not promote an upper-torso/shoulder shot to a headshot', () => {
    // just below the neck line, outside the sphere → stays a body shot
    expect(classifyHeadshot(0, HEAD_BOTTOM - 0.1, 0, 'body', bot)).toBe(false);
  });
});
