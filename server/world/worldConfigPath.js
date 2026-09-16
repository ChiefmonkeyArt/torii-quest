// server/world/worldConfigPath.js — pure candidate-path resolution for the legacy
// world.json the beacon serializes (ADR-0119 slice 4). Separated from arena-ws.js so
// it is unit-testable without importing the server entry (which starts listening).
import { join as pathJoin } from 'node:path';

/**
 * Candidate absolute paths for worlds/default/world.json, in precedence order.
 * Pure — the actual parsing/selection lives in the caller (arena-ws.js).
 *
 * @param {string} cwd process working directory (defaults to process.cwd()).
 * @param {NodeJS.ProcessEnv} [env] env lookup (defaults to process.env).
 * @returns {string[]} non-empty candidate paths.
 */
export function resolveLegacyWorldConfigPaths(cwd = process.cwd(), env = process.env) {
  const override = ((env && env.QUEST_WORLD_JSON_PATH) || '').trim();
  return [
    override,
    // bare-metal / source-run / plain systemd (WorkingDirectory === the repo root):
    pathJoin(cwd, 'worlds', 'default', 'world.json'),
    // Suite persistent-data layout: the MP server runs from <root>/mp while the
    // canonical, operator-editable world is served from <root>/data/worlds (the
    // SAME file the client loads via /quest/worlds/ — nginx aliases it there).
    pathJoin(cwd, '..', 'data', 'worlds', 'default', 'world.json'),
    // Suite release symlink fallback: <root>/current/worlds (a frozen release copy).
    pathJoin(cwd, '..', 'current', 'worlds', 'default', 'world.json'),
  ].filter(Boolean);
}