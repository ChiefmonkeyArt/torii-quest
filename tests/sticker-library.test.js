// tests/sticker-library.test.js — locks the content-addressed sticker library
// (src/engine/character/stickerLibrary.js): resolving a sticker hash to a
// fetchable Blossom URL, parsing a `torii.asset` sticker manifest into a library
// entry, and merging UGC entries into the seed library. Pure module → fully
// node-testable.
import { describe, it, expect } from 'vitest';
import {
  stickerImageUrl, isStickerAsset, parseStickerAssetManifest, mergeStickerLibrary,
  STICKER_ASSET_TYPE, DEFAULT_BLOSSOM_SERVER,
} from '../src/engine/character/stickerLibrary.js';

const SHA = 'cb321d5d47e5ba0ea4739123406e3bf060aac4ed3351d5ceecf1a63a1c309ae7';
const validManifest = () => ({
  v: 1,
  kind: 'torii.asset',
  creator: 'npub1test',
  type: STICKER_ASSET_TYPE,
  hash: SHA,
  url: `https://blossom.primal.net/${SHA}`,
  license: 'CC0-1.0',
  name: 'My Sticker',
});

describe('stickerImageUrl', () => {
  it('resolves a valid hash to the default Blossom URL', () => {
    expect(stickerImageUrl(SHA)).toBe(`${DEFAULT_BLOSSOM_SERVER}/${SHA}`);
  });

  it('honours a custom https Blossom server and strips a trailing slash', () => {
    expect(stickerImageUrl(SHA, 'https://blossom.example/')).toBe(`https://blossom.example/${SHA}`);
  });

  it('rejects a non-sha256 hash', () => {
    expect(stickerImageUrl('not-a-hash')).toBe(null);
    expect(stickerImageUrl('')).toBe(null);
    expect(stickerImageUrl(null)).toBe(null);
    expect(stickerImageUrl(undefined)).toBe(null);
  });

  it('rejects a non-https server', () => {
    expect(stickerImageUrl(SHA, 'http://blossom.example')).toBe(null);
    expect(stickerImageUrl(SHA, '')).toBe(null);
    expect(stickerImageUrl(SHA, 'javascript:alert(1)')).toBe(null);
  });
});

describe('isStickerAsset', () => {
  it('accepts a manifest with the sticker type', () => {
    expect(isStickerAsset(validManifest())).toBe(true);
  });

  it('rejects missing/other types and non-objects', () => {
    expect(isStickerAsset({ ...validManifest(), type: 'model/gltf-binary' })).toBe(false);
    expect(isStickerAsset({})).toBe(false);
    expect(isStickerAsset(null)).toBe(false);
    expect(isStickerAsset(undefined)).toBe(false);
    expect(isStickerAsset('x')).toBe(false);
  });
});

describe('parseStickerAssetManifest', () => {
  it('returns a frozen library entry with content-addressed id', () => {
    const entry = parseStickerAssetManifest(validManifest());
    expect(entry).toEqual({
      id: SHA,
      label: 'My Sticker',
      hash: SHA,
      recommendedZone: 'torso',
    });
    expect(Object.isFrozen(entry)).toBe(true);
  });

  it('defaults recommendedZone to torso when absent or unknown', () => {
    expect(parseStickerAssetManifest(validManifest())).toHaveProperty('recommendedZone', 'torso');
    const withBad = parseStickerAssetManifest({ ...validManifest(), recommendedZone: 'nope' });
    expect(withBad).toHaveProperty('recommendedZone', 'torso');
  });

  it('preserves a known recommendedZone', () => {
    const entry = parseStickerAssetManifest({ ...validManifest(), recommendedZone: 'head' });
    expect(entry).toHaveProperty('recommendedZone', 'head');
  });

  it('rejects a bad hash or missing label', () => {
    expect(parseStickerAssetManifest({ ...validManifest(), hash: 'zzz' })).toBe(null);
    expect(parseStickerAssetManifest({ ...validManifest(), name: '' })).toBe(null);
    expect(parseStickerAssetManifest({ ...validManifest(), name: '   ' })).toBe(null);
    expect(parseStickerAssetManifest({ ...validManifest(), type: 'model/gltf-binary' })).toBe(null);
    expect(parseStickerAssetManifest(null)).toBe(null);
  });
});

describe('mergeStickerLibrary', () => {
  const seed = Object.freeze([
    Object.freeze({ id: 'ftff', label: 'Torii sticker', hash: 'a'.repeat(64), recommendedZone: 'torso' }),
  ]);

  it('appends a valid entry as a new frozen array', () => {
    const entry = parseStickerAssetManifest(validManifest());
    const merged = mergeStickerLibrary(seed, entry);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toBe(seed[0]); // seed untouched + stays first
    expect(merged[1]).toEqual({ id: SHA, label: 'My Sticker', hash: SHA, recommendedZone: 'torso' });
    expect(Object.isFrozen(merged)).toBe(true);
    expect(Object.isFrozen(merged[1])).toBe(true);
  });

  it('dedupes by content hash', () => {
    const entry = parseStickerAssetManifest(validManifest());
    const once = mergeStickerLibrary(seed, entry);
    const twice = mergeStickerLibrary(once, entry);
    expect(twice).toHaveLength(2);
  });

  it('leaves the library untouched on an invalid entry', () => {
    expect(mergeStickerLibrary(seed, null)).toBe(seed);
    expect(mergeStickerLibrary(seed, { hash: 'bad', label: 'x' })).toBe(seed);
    expect(mergeStickerLibrary(seed, { hash: SHA, label: '' })).toBe(seed);
  });

  it('tolerates a non-array library (treats it as empty, then appends)', () => {
    const entry = parseStickerAssetManifest(validManifest());
    const merged = mergeStickerLibrary(null, entry);
    expect(Array.isArray(merged)).toBe(true);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(entry);
  });
});