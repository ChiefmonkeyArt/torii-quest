// Pure MOVE velocity calculation shared by the arena runtime and node tests.
// Positions are sampled after physics/collision correction, so the result
// describes the player's actual world-space movement rather than raw input.
export const MOVE_TELEPORT_DISTANCE = 50;

export function computeMoveVelocity(pos, lastPos, elapsedSeconds) {
  if (!Array.isArray(lastPos) || !(elapsedSeconds > 0)) return [0, 0, 0];

  const dx = pos[0] - lastPos[0];
  const dy = pos[1] - lastPos[1];
  const dz = pos[2] - lastPos[2];
  if (Math.hypot(dx, dy, dz) >= MOVE_TELEPORT_DISTANCE) return [0, 0, 0];

  const inv = 1 / elapsedSeconds;
  return [dx * inv, dy * inv, dz * inv];
}
