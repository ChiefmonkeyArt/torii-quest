import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BUNDLED_CHARACTER_PAIRS, bundledCharacterPair, resolveOwnCharacterPair, uploadCharacterPair } from '../src/engine/character/characterPair.js';

const chief = '7aecefff9ded689a1fce5afeb8b85fd954885ad422708e2d62f51c41a14d8cc3';
const custom = 'a'.repeat(64), head = 'b'.repeat(64);

describe('one full/headless pair per character identity', () => {
  it.each(Object.keys(BUNDLED_CHARACTER_PAIRS))('pins the bundled full file to its actual signed content hash %s', hash => {
    const pair = BUNDLED_CHARACTER_PAIRS[hash];
    const full = readFileSync(new URL(`../public${pair.full}`, import.meta.url));
    expect(createHash('sha256').update(full).digest('hex')).toBe(hash);
    const fp = readFileSync(new URL(`../public${pair.headless}`, import.meta.url));
    expect(fp.subarray(0,4).toString()).toBe('glTF');
    const json = JSON.parse(fp.subarray(20,20+fp.readUInt32LE(12)).toString());
    expect(json.extras.toriiHeadless.sourceSha256).toBe(hash);
  });
  it('restores the published chiefmonkey7 pair locally without remote authoring', async () => {
    const authorHeadless = vi.fn();
    const pair = await resolveOwnCharacterPair({mesh:{hash:chief,name:'chiefmonkey7.glb'}},{authorHeadless});
    expect(pair).toEqual({meshHash:chief,meshUrl:'/models/chiefmonkey7.glb',headlessUrl:'/chiefmonkey-headless.glb'});
    expect(authorHeadless).not.toHaveBeenCalled();
  });
  it('never selects chiefmonkey by an arbitrary display name', async () => {
    const pair = await resolveOwnCharacterPair({name:'Chiefmonkey',mesh:{hash:custom,headlessHash:head}});
    expect(pair.meshHash).toBe(custom);
    expect(pair.meshUrl).toContain(custom);
    expect(pair.headlessUrl).toContain(head);
    expect(bundledCharacterPair(custom)).toBeNull();
  });
  it('uses a published custom pair without authoring or substituting a built-in', async () => {
    const authorHeadless = vi.fn();
    const pair = await resolveOwnCharacterPair({mesh:{hash:custom,headlessHash:head}},{authorHeadless});
    expect(pair.headlessUrl).toBe(`https://blossom.primal.net/${head}`);
    expect(authorHeadless).not.toHaveBeenCalled();
  });
  it('authors a missing derivative from that exact custom full URL', async () => {
    const authorHeadless = vi.fn(async () => ({ok:true,url:'blob:own-body'}));
    const pair = await resolveOwnCharacterPair({mesh:{hash:custom}},{authorHeadless});
    expect(authorHeadless).toHaveBeenCalledWith({meshUrl:`https://blossom.primal.net/${custom}`});
    expect(pair.headlessUrl).toBe('blob:own-body');
  });
  it.each([async()=>({ok:false}),async()=>{throw Error('offline')}])('failed authoring yields no FP substitute', async authorHeadless => {
    const pair=await resolveOwnCharacterPair({mesh:{hash:custom}},{authorHeadless});
    expect(pair.meshHash).toBe(custom);
    expect(pair.headlessUrl).toBeNull();
  });
  it('an invalid manifest cannot seat a stray headless model', async () => {
    expect(await resolveOwnCharacterPair({mesh:{headlessHash:head}})).toEqual({meshUrl:null,meshHash:null,headlessUrl:null});
    expect(bundledCharacterPair('__proto__')).toBeNull();
    expect(bundledCharacterPair('constructor')).toBeNull();
  });
});

describe('upload and AI creation require a complete pair', () => {
  const file = new Blob(['full GLB']);
  const derived = new Blob(['derived GLB']);
  it('authors from and uploads the very same original file', async () => {
    const authorHeadless = vi.fn(async()=>({ok:true,blob:derived,sha256:head}));
    const upload=vi.fn().mockResolvedValueOnce({ok:true,sha256:custom}).mockResolvedValueOnce({ok:true,sha256:head});
    const result=await uploadCharacterPair(file,{authorHeadless,upload});
    expect(authorHeadless).toHaveBeenCalledWith(file);
    expect(upload.mock.calls).toEqual([[file],[derived]]);
    expect(result.mesh).toEqual({hash:custom,headlessHash:head,name:'custom.glb'});
  });
  it('failed derivation uploads and publishes nothing', async () => {
    const upload=vi.fn();
    expect((await uploadCharacterPair(file,{authorHeadless:async()=>({ok:false,error:'no-head-joint'}),upload})).ok).toBe(false);
    expect(upload).not.toHaveBeenCalled();
  });
  it('failed full upload does not upload a detached derivative', async () => {
    const upload=vi.fn(async()=>({ok:false,error:'offline'}));
    expect((await uploadCharacterPair(file,{authorHeadless:async()=>({ok:true,blob:derived,sha256:head}),upload})).ok).toBe(false);
    expect(upload).toHaveBeenCalledTimes(1);
  });
  it('rejects a derivative upload with the wrong content hash', async () => {
    const upload=vi.fn().mockResolvedValueOnce({ok:true,sha256:custom}).mockResolvedValueOnce({ok:true,sha256:custom});
    expect((await uploadCharacterPair(file,{authorHeadless:async()=>({ok:true,blob:derived,sha256:head}),upload})).ok).toBe(false);
  });
});
