// engine/plebeian/marketBoards3d.js — ADR-0145 (v0.2.919): the two in-world
// NAP market boards.
//   PRODUCT board: the existing PRODUCT sign (product-stall-panel); its plate
//                  now shows live product slides.
//   AUCTION board: a twin board past the mirror, on the same NAP-edge curve.
// Each board cycles a slide every SLIDE_SECONDS. The auction countdown repaints
// once a second, and only while the player is near that board. Data comes from
// ownerBoards (same store source, signature-checked) plus signed bids and
// seller profiles, all on the shared relay layer. Everything runs only while
// the player is in the NAP Zone.
import * as THREE from 'three';
import { onOwnerBoardsData, setBoardsWorldWanted } from './ownerBoards.js';
import { subscribeByAuthor, fetchProfiles, PLEBEIAN_BID_KIND } from './plebeianRelay.js';
import {
  buildProductSlides, buildAuctionSlides, retimeAuctionSlide, slideIndexAt, sellersNeeded, SLIDE_SECONDS,
  BOARD_CACHE_KEY, BOARD_CACHE_HOLD_MS, serializeBoardCache, parseBoardCache, mergeWithCache,
} from './marketBoardModel.js';
import { paintBoard, BOARD_W, BOARD_H } from './marketBoardPainter.js';
import { PLEBEIAN_PRODUCT_RELAYS, PLEBEIAN_AUCTION_RELAYS } from '../../config.js';
import { DEFAULT_NODE_RELAYS } from '../presence/nodeRelays.js';

/** Auction board placement: past the mirror's east end, following the coast. */
export const AUCTION_BOARD_SPEC = Object.freeze({
  id: 'auction-board',
  position: Object.freeze({ x: 12.4, y: 2.0, z: 26.0 }),
  yawRad: Math.PI + 0.915,
});
export const COUNTDOWN_NEAR_M = 22;
const IMAGE_CACHE_MAX = 32;
const PROFILE_RETRY_MS = 60000;

let _built = false;
let _boards = null; // { products: {canvas, ctx, tex, ...}, auctions: {...} }
let _products = [], _auctions = [];
let _rawAuctions = [], _bidEvents = [];
let _profiles = new Map();
let _profileKey = '', _profileAt = 0;
let _bidSubs = [], _bidKey = '';
let _offData = null;
let _wanted = false;
let _elapsed = 0, _lastSec = -1;
const _images = new Map(); // url → { img, ok }
// v0.2.920: saved listings + touch wording
let _touch = false;
let _saved = null;          // parsed cache { owner, products, auctions }
let _liveSince = 0;         // ms when the live feed (re)started
let _holdPending = false;   // re-blend once the hold window ends
let _cachedP = false, _cachedA = false;
let _owner = '';
let _saveDue = false, _lastSaved = '', _lastSaveAt = 0;
const SAVE_EVERY_MS = 5000;

function _storage() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } }
function _loadSaved() {
  const ls = _storage();
  if (!ls) return null;
  try { return parseBoardCache(ls.getItem(BOARD_CACHE_KEY), Math.floor(Date.now() / 1000), ''); } catch { return null; }
}

function _getImage(url) {
  const hit = _images.get(url);
  if (hit) return hit.ok ? hit.img : null;
  if (typeof Image === 'undefined') return null;
  if (_images.size >= IMAGE_CACHE_MAX) _images.delete(_images.keys().next().value);
  const img = new Image();
  const rec = { img, ok: false };
  _images.set(url, rec);
  img.crossOrigin = 'anonymous';
  img.referrerPolicy = 'no-referrer';
  img.decoding = 'async';
  img.onload = () => { rec.ok = true; _dirtyAll(); };
  img.onerror = () => { rec.ok = false; };
  img.src = url;
  return null;
}

function _makeBoard(plate, name) {
  const canvas = document.createElement('canvas');
  canvas.width = BOARD_W; canvas.height = BOARD_H;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  if (plate.material && plate.material.map && plate.material.map !== tex) plate.material.map.dispose();
  plate.material = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  plate.name = 'market-plate:' + name;
  return { canvas, ctx, tex, plate, dirty: true, shown: -1, worldPos: new THREE.Vector3() };
}

/**
 * Build both boards. `getBoard(id)` → { board, plate } (proofSurfaceMeshes).
 * No-op (returns false) when the PRODUCT sign isn't built (minimal mode).
 */
export function initMarketBoards3d({ scene, getBoard, sampleHeight, touch = false } = {}) {
  if (_built) return true;
  _touch = !!touch;
  const src = typeof getBoard === 'function' ? getBoard('product-stall-panel') : null;
  if (!src || !src.board || !src.plate || !scene || typeof document === 'undefined') return false;
  const products = _makeBoard(src.plate, 'products');
  src.board.getWorldPosition(products.worldPos);

  // Twin built from the SAME geometry (no deep clone: that would copy any
  // sticker decals parented to the product board, and share its texture).
  const twin = new THREE.Mesh(src.board.geometry, src.board.material.clone());
  twin.name = 'proof-board:' + AUCTION_BOARD_SPEC.id;
  twin.receiveShadow = true;
  const twinPlate = new THREE.Mesh(src.plate.geometry, new THREE.MeshBasicMaterial());
  twinPlate.position.copy(src.plate.position);
  twin.add(twinPlate);
  const p = AUCTION_BOARD_SPEC.position;
  const h = typeof sampleHeight === 'function' ? sampleHeight(p.x, p.z) : 0;
  twin.position.set(p.x, p.y + h, p.z);
  twin.rotation.set(0, AUCTION_BOARD_SPEC.yawRad, 0);
  const auctions = _makeBoard(twinPlate, 'auctions');
  (src.board.parent || scene).add(twin);
  twin.updateMatrixWorld(true);
  twin.getWorldPosition(auctions.worldPos);

  _boards = { products, auctions, twin };
  _built = true;
  _saved = _loadSaved();
  if (_saved) {
    _products = _saved.products; _auctions = _saved.auctions;
    _cachedP = _products.length > 0; _cachedA = _auctions.length > 0;
  }
  _paint('products'); _paint('auctions');
  return true;
}

/** True once both boards exist (legacy arena build; not in minimal worlds). */
export function marketBoards3dBuilt() { return _built; }

/** World position of the auction board (for its Q trigger). */
export function auctionBoardPosition(sampleHeight) {
  const p = AUCTION_BOARD_SPEC.position;
  return { x: p.x, y: p.y + (typeof sampleHeight === 'function' ? sampleHeight(p.x, p.z) : 0), z: p.z };
}

function _dirtyAll() { if (_boards) { _boards.products.dirty = true; _boards.auctions.dirty = true; } }

function _paint(which) {
  const b = _boards && _boards[which];
  if (!b) return;
  const list = which === 'products' ? _products : _auctions;
  const i = slideIndexAt(_elapsed, list.length);
  let slide = i >= 0 ? list[i] : null;
  if (slide && slide.kind === 'auction') slide = retimeAuctionSlide(slide, Math.floor(Date.now() / 1000));
  paintBoard(b.ctx, { board: which, slide, index: Math.max(0, i), count: list.length, getImage: _getImage, touch: _touch, cached: which === 'products' ? _cachedP : _cachedA });
  b.tex.needsUpdate = true;
  b.dirty = false;
  b.shown = i;
}

function _rebuild(rawProducts) {
  const now = Math.floor(Date.now() / 1000);
  const liveP = buildProductSlides(rawProducts, _profiles);
  const liveA = buildAuctionSlides(_rawAuctions, _bidEvents, _profiles, now);
  const holding = !!_saved && Date.now() - _liveSince < BOARD_CACHE_HOLD_MS;
  _holdPending = holding;
  _products = _saved ? mergeWithCache(liveP, _saved.products, holding) : liveP;
  _auctions = _saved ? mergeWithCache(liveA, _saved.auctions, holding) : liveA;
  _cachedP = !liveP.length && _products.length > 0;
  _cachedA = !liveA.length && _auctions.length > 0;
  if (liveP.length || liveA.length) _saveDue = true;
  _dirtyAll();
}

function _maybeSave() {
  if (!_saveDue || Date.now() - _lastSaveAt < SAVE_EVERY_MS) return;
  _saveDue = false; _lastSaveAt = Date.now();
  const json = serializeBoardCache({ owner: _owner, products: _cachedP ? [] : _products, auctions: _cachedA ? [] : _auctions }, Math.floor(Date.now() / 1000));
  if (!json || json === _lastSaved) return;
  const ls = _storage();
  try { if (ls) { ls.setItem(BOARD_CACHE_KEY, json); _lastSaved = json; } } catch { /* quota / private mode */ }
}

let _lastRawProducts = [];
function _onData({ products, auctions, store }) {
  const seller = store && typeof store.seller === 'string' ? store.seller : '';
  if (seller) {
    if (_saved && _saved.owner && _saved.owner !== seller) _saved = null; // another owner's shop
    _owner = seller;
  }
  _lastRawProducts = products || [];
  _rawAuctions = auctions || [];
  _syncBids();
  _rebuild(_lastRawProducts);
  _syncProfiles();
}

function _syncBids() {
  const ids = _rawAuctions.map((e) => e && e.id).filter(Boolean).slice(0, 8).sort();
  const key = ids.join(',');
  if (key === _bidKey) return;
  _bidKey = key;
  for (const s of _bidSubs) { try { s.close(); } catch { /* closed */ } }
  _bidSubs = []; _bidEvents = [];
  if (!ids.length) return;
  const byRelay = new Map();
  for (const url of PLEBEIAN_AUCTION_RELAYS) {
    _bidSubs.push(subscribeByAuthor({
      url, filters: [{ kinds: [PLEBEIAN_BID_KIND], '#e': ids, limit: 500 }],
      onUpdate: (events) => {
        byRelay.set(url, events);
        const seen = new Set(); _bidEvents = [];
        for (const list of byRelay.values()) for (const e of list) if (e && !seen.has(e.id)) { seen.add(e.id); _bidEvents.push(e); }
        _rebuild(_lastRawProducts);
      },
    }));
  }
}

function _syncProfiles() {
  const need = sellersNeeded(_products, _auctions);
  const key = need.join(',');
  if (!need.length || (key === _profileKey && Date.now() - _profileAt < PROFILE_RETRY_MS)) return;
  _profileKey = key; _profileAt = Date.now();
  const relays = [...new Set([...PLEBEIAN_PRODUCT_RELAYS, ...DEFAULT_NODE_RELAYS])];
  fetchProfiles(need, relays).then((m) => {
    if (!(m && m.size)) return;
    for (const [k, v] of m) _profiles.set(k, v);
    _rebuild(_lastRawProducts);
  }).catch(() => { /* boards keep the short-id fallback */ });
}

function _setWanted(w) {
  if (w === _wanted) return;
  _wanted = w;
  if (w) _liveSince = Date.now();
  setBoardsWorldWanted(w);
  if (w && !_offData) _offData = onOwnerBoardsData(_onData);
  if (!w) {
    if (_offData) { _offData(); _offData = null; }
    for (const s of _bidSubs) { try { s.close(); } catch { /* closed */ } }
    _bidSubs = []; _bidKey = '';
  }
}

/**
 * Per-frame (NAP branch of the arena tick). Cheap when nothing changes: a
 * repaint happens only on a slide change, new data, an image arriving, or once
 * a second for the auction countdown while the player is near that board.
 */
export function tickMarketBoards3d(dt, playerPos, inNap) {
  if (!_built) return;
  _setWanted(!!inNap);
  if (!inNap) return;
  _elapsed += Math.max(0, Math.min(0.25, Number(dt) || 0));
  const b = _boards;
  if (slideIndexAt(_elapsed, _products.length) !== b.products.shown) b.products.dirty = true;
  if (slideIndexAt(_elapsed, _auctions.length) !== b.auctions.shown) b.auctions.dirty = true;
  const sec = Math.floor(Date.now() / 1000);
  if (sec !== _lastSec) {
    _lastSec = sec;
    const cur = _auctions[b.auctions.shown];
    if (cur && cur.phase !== 'ended' && playerPos && playerPos.distanceTo && playerPos.distanceTo(b.auctions.worldPos) < COUNTDOWN_NEAR_M) b.auctions.dirty = true;
  }
  if (_holdPending && Date.now() - _liveSince >= BOARD_CACHE_HOLD_MS) _rebuild(_lastRawProducts);
  _maybeSave();
  if (b.products.dirty) _paint('products');
  if (b.auctions.dirty) _paint('auctions');
}

/**
 * v0.2.922 (ADR-0147 M1): leaving the home world (in-place travel) stops the
 * board feeds (owner store, bids), frees the two canvas textures and the twin's
 * material, and forgets the boards. The meshes themselves are swept with the
 * proof-surfaces group. Safe to call twice; boards can be built again later.
 */
export function disposeMarketBoards3d() {
  _setWanted(false);
  if (_boards) {
    for (const k of ['products', 'auctions']) {
      const b = _boards[k];
      try { b.tex.dispose(); } catch { /* gone */ }
      try { b.plate.material.dispose(); } catch { /* gone */ }
    }
    try { _boards.twin.material.dispose(); } catch { /* gone */ }
    try { if (_boards.twin.parent) _boards.twin.parent.remove(_boards.twin); } catch { /* gone */ }
  }
  _boards = null; _built = false;
  _products = []; _auctions = []; _rawAuctions = []; _bidEvents = []; _lastRawProducts = [];
  _elapsed = 0; _lastSec = -1; _holdPending = false; _cachedP = false; _cachedA = false;
  _images.clear();
}

/** Debug: ToriiDebug.marketBoards(). */
export function marketBoards3dState() {
  return {
    built: _built, wanted: _wanted,
    products: _products.map((s) => ({ title: s.title, price: s.price, seller: s.seller.name })),
    auctions: _auctions.map((s) => ({ title: s.title, phase: s.phase, countdown: s.countdown.text, highBid: s.highBid, bids: s.bidCount, bidders: s.bidders, seller: s.seller.name })),
    bids: _bidEvents.length, profiles: _profiles.size, images: _images.size,
    saved: { loaded: !!_saved, showingP: _cachedP, showingA: _cachedA }, touch: _touch,
    slideSeconds: SLIDE_SECONDS,
  };
}
