// ghost-eviction.test.js — source contract for the v0.2.615 crash-ghost fix.
//
// arena-ws.js has no exports (the WS layer is wired inline), so this locks the
// eviction seam by source assertion — the same pattern as pause-input.test.js.
// The behavioural half of the fix (client self-filter) is covered in
// multiplayer-host.test.js ("self-ghost filter").
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SERVER = readFileSync(join(ROOT, 'server/arena-ws.js'), 'utf8');

describe('server crash-ghost eviction (v0.2.615)', () => {
  it('finishAuth evicts any prior authed session with the same pubkey', () => {
    // One live session per identity: a crashed client's half-open socket must
    // be closed when the player re-auths with the same key, or every peer sees
    // TWO of them ("2 chiefmonkeys as well as myself").
    expect(SERVER).toMatch(/other\.id !== sess\.id && other\.authed && other\.pubkey === pubkey/);
    expect(SERVER).toMatch(/closeSession\(other, 'superseded'\)/);
    // The eviction must run BEFORE the roster snapshot + JOIN broadcast, or the
    // ghost would still be announced to peers for this join.
    const fnStart = SERVER.indexOf('function finishAuth(');
    const evictAt = SERVER.indexOf("closeSession(other, 'superseded')", fnStart);
    const authedAt = SERVER.indexOf('sess.authed = true;', fnStart);
    expect(fnStart).toBeGreaterThan(-1);
    expect(evictAt).toBeGreaterThan(fnStart);
    expect(authedAt).toBeGreaterThan(evictAt);
  });
});
