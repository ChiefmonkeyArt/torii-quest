// mp1-compat.test.js — the server is combat-authoritative, full stop.
//
// Game Zone v2 (ADR-0130) replaced the SHOT/HIT/KILL pipeline (and the long-dead
// MP_MODE=advisory branches) with GZ_FIRE → shared sim → GZ_EVENT. These source
// guards make sure no client-authored combat frame can ever be relayed again:
// legacy SHOT/HIT/KILL frames from old clients fall through to the default
// (ignored), and the only combat ingress is the validated, rate-limited GZ_FIRE.
// We inspect the source rather than boot a ws server (arena-ws.js has no exports).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(__dirname, '../../server/arena-ws.js'), 'utf8');
const gz = readFileSync(resolve(__dirname, '../../server/gamezone/gameZoneServer.js'), 'utf8');

describe('authoritative combat (Game Zone v2)', () => {
  it('has no MP_MODE / advisory path left', () => {
    expect(src).not.toMatch(/MP_MODE\s*===/);
    expect(src).not.toMatch(/['"]advisory['"]\s*\)/);
  });

  it('never relays a client SHOT / HIT / KILL frame', () => {
    expect(src).not.toMatch(/case\s+MSG\.SHOT\b/);
    expect(src).not.toMatch(/case\s+MSG\.HIT\b/);
    expect(src).not.toMatch(/case\s+MSG\.KILL\b/);
  });

  it('GZ_FIRE is the only combat ingress, rate-limited and handed to the game zone', () => {
    const block = src.match(/case\s+MSG\.GZ_FIRE:\s*\{[\s\S]*?\n {4}\}/);
    expect(block).not.toBeNull();
    expect(block[0]).toMatch(/gameZone\.onFire\(/);
    expect(block[0]).toMatch(/rate|limit/i);
  });

  it('shot results go only to the shooter; everything else to all seated peers', () => {
    expect(gz).toMatch(/if \(e\.type === 'result'\)/);
    expect(gz).toMatch(/sendTo\(s, \{ t: MSG\.GZ_EVENT, tick, ev: list \}\)/);
  });

  it('RESPAWN is sent only to the victim (sendTo), the others get a MOVE', () => {
    const fn = gz.slice(gz.indexOf('function _applyRespawn'), gz.indexOf('function onAuth'));
    expect(fn).toMatch(/sendTo\(s, \{ t: MSG\.RESPAWN/);
    expect(fn).toMatch(/broadcastToOthers\(s\.id, \{ t: MSG\.MOVE/);
  });

  it('healthz reports authoritative mode', () => {
    expect(src).toMatch(/mode:\s*'authoritative'/);
  });
});
