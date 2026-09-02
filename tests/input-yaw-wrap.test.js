// @vitest-environment jsdom
// input.js yaw wrapping (ADR-0051). The pointer-lock yaw accumulates without
// bound (each mousemove subtracts movementX * SENS), so after a full 360° turn
// the raw value exceeds 2π and the server's isRot2 check (ROT_ABS = 2π) rejects
// every MOVE message with BAD_FIELD — the client keeps moving but the server
// stops tracking it. wrapAngle normalises to [-π, π] on read so the wire always
// sees a valid angle while the internal accumulator stays continuous.
import { describe, test, expect, beforeEach, vi } from 'vitest';

describe('input.js yaw wrapping (ADR-0051)', () => {
  let input;

  beforeEach(async () => {
    vi.resetModules();
    input = await import('../src/input.js');
  });

  test('wrapAngle leaves 0 and ±π unchanged', () => {
    expect(input.wrapAngle(0)).toBe(0);
    expect(input.wrapAngle(Math.PI)).toBe(Math.PI);
    expect(input.wrapAngle(-Math.PI)).toBe(-Math.PI);
  });

  test('wrapAngle leaves in-range values unchanged', () => {
    expect(input.wrapAngle(1.5)).toBeCloseTo(1.5, 10);
    expect(input.wrapAngle(-2.0)).toBeCloseTo(-2.0, 10);
  });

  test('wrapAngle wraps a value just past one full turn back into range', () => {
    // 360° + 40° ≈ 7.0 rad — the exact class of value that triggered BAD_FIELD.
    expect(input.wrapAngle(7.0)).toBeCloseTo(7.0 - Math.PI * 2, 10);
    expect(input.wrapAngle(-7.0)).toBeCloseTo(-7.0 + Math.PI * 2, 10);
  });

  test('wrapAngle handles many full turns', () => {
    expect(input.wrapAngle(Math.PI * 4)).toBeCloseTo(0, 10);
    expect(input.wrapAngle(Math.PI * 10)).toBeCloseTo(0, 10);
  });

  test('getYaw returns a wrapped value after setYaw with an unwrapped angle', () => {
    input.setYaw(7.0); // 360° + 40°
    const y = input.getYaw();
    expect(y).toBeGreaterThanOrEqual(-Math.PI);
    expect(y).toBeLessThanOrEqual(Math.PI);
    expect(y).toBeCloseTo(7.0 - Math.PI * 2, 10);
  });

  test('getYaw stays within [-π, π] across five full turns', () => {
    input.setYaw(Math.PI * 10);
    const y = input.getYaw();
    expect(y).toBeGreaterThanOrEqual(-Math.PI);
    expect(y).toBeLessThanOrEqual(Math.PI);
  });
});
