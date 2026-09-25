import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the actual shell functions with injected arena/relay edges. This
// catches the original late-login bug, not just a matching source comment.
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const apply=main.slice(main.indexOf('function _applyOwnCharacterMesh()'),main.indexOf('// ── Access tab'));
const seat=main.slice(main.indexOf('function _seatCharacterIntoArena('),main.indexOf('// v0.2.275: shared bootstrap'));
function harness() {
  const calls=[];
  const arena={
    setCharacter:v=>calls.push(['character',v]),
    setCustomMeshUrl:v=>calls.push(['full',v]),
    setCustomMeshHash:v=>calls.push(['hash',v]),
    setCustomHeadlessUrl:v=>calls.push(['headless',v]),
    reloadCharacterAssets:vi.fn(async()=>calls.push(['reload'])),
  };
  const ctx=vm.createContext({
    _ownCharacterRevision:0,_ownCharacterLoad:null,
    _ownCharacterMeshUrl:null,_ownCharacterMeshHash:null,_ownCharacterHeadlessUrl:null,
    _arena:arena,_arenaBootstrapped:true,_guestCharChosen:false,_pendingGuestChar:'guest',
    state:{nostrPubkey:'a'.repeat(64)},fetchOwnCharacter:vi.fn(async()=>({})),
    resolveOwnCharacterPair:vi.fn(async()=>({meshUrl:'/chief.glb',meshHash:'hash',headlessUrl:'/chief-headless.glb'})),
    authorOwnHeadless:vi.fn(),revokeHeadlessUrl:vi.fn(),
  });
  vm.runInContext(`${apply}\n${seat}`,ctx);
  return {ctx,calls,arena};
}
describe('atomic identity seating',()=>{
  it('late character discovery seats full/hash/headless before reloading either view',async()=>{
    const {ctx,calls}=harness();
    await ctx._applyOwnCharacterMesh();
    expect(calls).toEqual([['character','guest'],['full','/chief.glb'],['hash','hash'],['headless','/chief-headless.glb'],['reload']]);
  });
  it('ignores and revokes a stale response from the previous login',async()=>{
    const {ctx,calls}=harness();
    let release;
    ctx.fetchOwnCharacter=()=>new Promise(resolve=>{release=resolve});
    const pending=ctx._applyOwnCharacterMesh();
    ctx.state.nostrPubkey='b'.repeat(64);
    release({});
    await pending;
    expect(calls).toEqual([]);
    expect(ctx.revokeHeadlessUrl).toHaveBeenCalledWith('/chief-headless.glb');
  });
  it('does not overwrite an explicit guest selection after discovery',async()=>{
    const {ctx,calls}=harness();ctx._guestCharChosen=true;
    await ctx._applyOwnCharacterMesh();
    expect(calls).toEqual([]);
  });
  it('normal boot commits both URLs but does not reload an unbooted arena',async()=>{
    const {ctx,arena}=harness();ctx._arenaBootstrapped=false;
    await ctx._applyOwnCharacterMesh();
    expect(ctx._ownCharacterMeshUrl).toBe('/chief.glb');
    expect(ctx._ownCharacterHeadlessUrl).toBe('/chief-headless.glb');
    expect(arena.reloadCharacterAssets).not.toHaveBeenCalled();
  });
  it('entry awaits identity resolution before seating or booting',()=>{
    const body=main.slice(main.indexOf('async function ensureArenaReady('),main.indexOf('async function ensureArenaReady(')+1000);
    expect(body.indexOf('await (_ownCharacterLoad || _applyOwnCharacterMesh())')).toBeLessThan(body.indexOf('_seatCharacterIntoArena(_arena)'));
  });
  it('headless body never falls back to guest when a custom full model is set',()=>{
    const fp=readFileSync(new URL('../src/firstPersonBody.js',import.meta.url),'utf8');
    expect(fp).toContain('getCustomMeshUrl() ? null : FP_BODIES[getCharacter()]');
  });
});
// The complete model is loaded first; its animation clips are the bind-frame
// authority for the derivative. Exercise the actual exported function.
describe('paired first-person locomotion clips', () => {
  const source=readFileSync(new URL('../src/playerModel.js',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('export function getFirstPersonClips()'),
    source.indexOf('\n}',source.indexOf('export function getFirstPersonClips()'))+2).replace('export ','');
  it('clones the full model’s resolved clips, without duplicates or unrelated actions',()=>{
    const idle={clone:vi.fn(()=>({name:'corrected-idle'}))};
    const run={clone:vi.fn(()=>({name:'corrected-run'}))};
    const ctx=vm.createContext({_loaded:true,_anims:{IDLE:'Idle_02',WALK:'Idle_02',RUN:'Running'},
      _clips:{Idle_02:idle,Running:run,FunnyDancing_02:{}}});
    vm.runInContext(fn,ctx);
    expect(ctx.getFirstPersonClips()).toEqual([{name:'corrected-idle'},{name:'corrected-run'}]);
    expect(idle.clone).toHaveBeenCalledTimes(1);
    const fp=readFileSync(new URL('../src/firstPersonBody.js',import.meta.url),'utf8');
    expect(fp).toContain('const bodyClips = pairedClips.length ? pairedClips : gltf.animations');
  });
  it('cannot reuse a previous character’s clips while the full model is unloaded',()=>{
    const ctx=vm.createContext({_loaded:false});
    vm.runInContext(fn,ctx);
    expect(ctx.getFirstPersonClips()).toEqual([]);
  });
});
