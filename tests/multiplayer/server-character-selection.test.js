import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyCharacterSelection,
  SUPPORTED_CHARACTERS,
} from '../../server/presence/characterSelection.js';

const arenaServer = readFileSync(resolve(import.meta.dirname, '../../server/arena-ws.js'), 'utf8');

describe('server SET_CHAR handling', () => {
  it('updates the authenticated session and builds the refreshed JOIN fields', () => {
    const sess = {
      id: 'peer1',
      npub: 'npub1' + 'x'.repeat(58),
      pos: [1, 2, 3],
      rot: [0.25, 0],
      character: 'chiefmonkey',
    };
    const peer = applyCharacterSelection(sess, 'nostrich');
    expect(sess.character).toBe('nostrich');
    expect(peer).toEqual({
      id: sess.id,
      npub: sess.npub,
      pos: sess.pos,
      rot: sess.rot,
      character: 'nostrich',
    });
  });

  it('supports only client-loadable character keys', () => {
    expect(SUPPORTED_CHARACTERS).toEqual(['chiefmonkey', 'nostrich']);
    const sess = { character: 'chiefmonkey' };
    expect(applyCharacterSelection(sess, 'unknown')).toBeNull();
    expect(sess.character).toBe('chiefmonkey');
  });

  it('wires SET_CHAR into the authenticated server switch and broadcasts JOIN', () => {
    expect(arenaServer).toMatch(/case MSG\.SET_CHAR:[\s\S]*?applyCharacterSelection\(sess,\s*msg\.character\)/);
    expect(arenaServer).toMatch(/case MSG\.SET_CHAR:[\s\S]*?broadcastToOthers\(sess\.id,\s*\{\s*t:\s*MSG\.JOIN,\s*\.\.\.peer\s*\}\)/);
  });
});
