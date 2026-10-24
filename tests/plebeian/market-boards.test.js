// ADR-0145 (v0.2.919): the two live in-world NAP market boards — PRODUCT and
// AUCTION — with countdowns, bid totals and seller avatars.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { signEvent } from '../../conformance/gateway-v1/gate-v1.mjs';
import {
  SLIDE_SECONDS, MAX_SLIDES, safeImageUrl, formatAmount, formatCountdown, sellerOf,
  buildProductSlides, bidsFor, buildAuctionSlides, retimeAuctionSlide, slideIndexAt, sellersNeeded,
  serializeBoardCache, parseBoardCache, mergeWithCache, BOARD_CACHE_MAX_AGE_S, BOARD_CACHE_MAX_BYTES, BOARD_CACHE_KEY,
} from '../../src/engine/plebeian/marketBoardModel.js';
import { paintBoard, wrapLines, fitFont, BOARD_W, BOARD_H } from '../../src/engine/plebeian/marketBoardPainter.js';

const SK_SELLER = '22'.repeat(32), SK_B1 = '44'.repeat(32), SK_B2 = '55'.repeat(32);
const pk = (sk) => signEvent({ kind: 1, created_at: 1, tags: [], content: '' }, sk).pubkey;
const SELLER = pk(SK_SELLER), B1 = pk(SK_B1), B2 = pk(SK_B2);
const NOW = 2_000_000_000;

const product = (d, tags = [], at = 10) => signEvent({ kind: 30402, created_at: at, tags: [['d', d], ...tags, ['title', d], ['price', '15', 'GBP'], ['visibility', 'on-sale'], ['stock', '3'], ['image', 'https://img.example/p.jpg']], content: '' }, SK_SELLER);
const auction = (d, start, end, tags = []) => signEvent({ kind: 30408, created_at: 10, tags: [['d', d], ['title', 'Auction ' + d], ['currency', 'SAT'], ['starting_bid', '1000'], ['start_at', String(start)], ['end_at', String(end)], ...tags], content: '' }, SK_SELLER);
const bid = (auc, amount, at, sk = SK_B1) => signEvent({ kind: 1023, created_at: at, tags: [['e', auc.id], ['amount', String(amount)]], content: '' }, sk);

describe('formatting', () => {
  it('amounts: sats with separators, fiat keeps its code', () => {
    expect(formatAmount(169000, 'SAT')).toBe('169,000 sats');
    expect(formatAmount(15, 'gbp')).toBe('15 GBP');
    expect(formatAmount('x', 'SAT')).toBe('');
  });
  it('countdowns by phase, with urgency tone in the last 10 minutes', () => {
    expect(formatCountdown({ phase: 'live', secondsRemaining: 2 * 86400 + 4 * 3600 }, 0)).toEqual({ text: 'Ends in 2d 04h', tone: 'live' });
    expect(formatCountdown({ phase: 'live', secondsRemaining: 3 * 3600 + 5 * 60 }, 0).text).toBe('Ends in 3h 05m');
    expect(formatCountdown({ phase: 'live', secondsRemaining: 125 }, 0)).toEqual({ text: 'Ends in 2m 05s', tone: 'soon' });
    expect(formatCountdown({ phase: 'upcoming', secondsRemaining: 90 }, 0)).toEqual({ text: 'Starts in 1m 30s', tone: 'upcoming' });
    expect(formatCountdown({ phase: 'ended', secondsRemaining: 0 }, Date.UTC(2026, 7, 21) / 1000)).toEqual({ text: 'Ended 21 Aug 2026', tone: 'ended' });
    expect(formatCountdown(null).text).toBe('');
  });
  it('images: https only', () => {
    expect(safeImageUrl('https://a.example/x.png')).toBe('https://a.example/x.png');
    for (const bad of ['http://a.example/x.png', 'javascript:alert(1)', 'data:image/png;base64,AA', '', null, 'https://' + 'a'.repeat(3000)]) expect(safeImageUrl(bad)).toBeNull();
  });
  it('seller: profile name + https picture, else short id', () => {
    const profiles = new Map([[SELLER, { name: 'Chiefmonkey', picture: 'http://insecure/x.png' }]]);
    expect(sellerOf(SELLER, profiles)).toEqual({ pubkey: SELLER, name: 'Chiefmonkey', picture: null });
    expect(sellerOf(B1, profiles).name).toBe(B1.slice(0, 8));
  });
});

describe('slides', () => {
  it('products: on-sale only, price + stock + seller, capped', () => {
    const hidden = product('hidden', [['visibility', 'hidden']]);
    const s = buildProductSlides([product('noodles'), hidden], new Map([[SELLER, { name: 'Chiefmonkey' }]]));
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ kind: 'product', title: 'noodles', price: '15 GBP', stock: '3 in stock', image: 'https://img.example/p.jpg' });
    expect(s[0].seller.name).toBe('Chiefmonkey');
    const many = Array.from({ length: MAX_SLIDES + 5 }, (_, i) => product('p' + i, [], 10 + i));
    expect(buildProductSlides(many, new Map())).toHaveLength(MAX_SLIDES);
  });
  it('bids: signed, for THIS auction only; a forged bid is not counted', () => {
    const a = auction('a1', NOW - 100, NOW + 100);
    const other = auction('a2', NOW - 100, NOW + 100);
    const good = bid(a, 2000, NOW - 50);
    const forged = { ...bid(a, 999999, NOW - 40), sig: 'ab'.repeat(64) };
    const tampered = { ...bid(a, 3000, NOW - 30) }; tampered.tags = [['e', a.id], ['amount', '900000']];
    const elsewhere = bid(other, 5000, NOW - 20);
    const parsed = { ...a, aTag: `30408:${SELLER}:a1` };
    expect(bidsFor(parsed, [good, forged, tampered, elsewhere, null, { kind: 1 }]).map((e) => e.id)).toEqual([good.id]);
  });
  it('auctions: high bid, bid count, distinct bidders, countdown; live → upcoming → ended', () => {
    const live = auction('live', NOW - 100, NOW + 3600);
    const soon = auction('soon', NOW + 50, NOW + 9000);
    const done = auction('done', NOW - 9000, NOW - 100);
    const bids = [bid(live, 2000, NOW - 90), bid(live, 1500, NOW - 80, SK_B2), bid(live, 4000, NOW - 70, SK_B2)];
    const s = buildAuctionSlides([done, soon, live], bids, new Map(), NOW);
    expect(s.map((x) => x.phase)).toEqual(['live', 'upcoming', 'ended']);
    expect(s[0]).toMatchObject({ highBid: '4,000 sats', bidCount: 3, bidders: 2, countdown: { text: 'Ends in 1h 00m', tone: 'live' } });
    expect(s[1].countdown.text).toBe('Starts in 0m 50s');
    expect(s[2]).toMatchObject({ highBid: '', startingBid: '1,000 sats', bidCount: 0 });
    expect(s[2].countdown.tone).toBe('ended');
  });
  it('retime moves the countdown without re-parsing; ends cleanly', () => {
    const [s] = buildAuctionSlides([auction('x', NOW - 10, NOW + 120)], [], new Map(), NOW);
    expect(retimeAuctionSlide(s, NOW + 60).countdown.text).toBe('Ends in 1m 00s');
    expect(retimeAuctionSlide(s, NOW + 500).phase).toBe('ended');
    expect(retimeAuctionSlide(null, NOW)).toBeNull();
  });
  it('slide cycling + sellers needed', () => {
    expect(slideIndexAt(0, 3)).toBe(0);
    expect(slideIndexAt(SLIDE_SECONDS * 4 + 1, 3)).toBe(1);
    expect(slideIndexAt(5, 0)).toBe(-1);
    expect(sellersNeeded([{ seller: { pubkey: 'a' } }], [{ seller: { pubkey: 'a' } }, { seller: { pubkey: 'b' } }])).toEqual(['a', 'b']);
  });
});

// Recording 2D context: measureText ≈ 0.5em per char.
function fakeCtx() {
  const texts = [], images = [];
  let font = '10px x';
  const ctx = {
    get font() { return font; }, set font(f) { font = f; },
    fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: '', textBaseline: '',
    measureText: (t) => ({ width: String(t).length * (parseInt(/(\d+)px/.exec(font)[1], 10) / 2) }),
    fillText: (t) => texts.push(String(t)), drawImage: (...a) => images.push(a),
  };
  for (const k of ['fillRect', 'beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'closePath', 'fill', 'clip', 'save', 'restore', 'arc', 'stroke']) ctx[k] = () => {};
  return { ctx, texts, images };
}

describe('painter', () => {
  const seller = { pubkey: SELLER, name: 'Chiefmonkey', picture: 'https://img.example/me.png' };
  it('auction slide: countdown, winning bid, bid totals, seller + avatar image', () => {
    const { ctx, texts, images } = fakeCtx();
    const img = { naturalWidth: 400, naturalHeight: 200 };
    paintBoard(ctx, { board: 'auctions', index: 1, count: 3, getImage: () => img, slide: {
      kind: 'auction', title: 'Building from Strength to Strength', image: 'https://img.example/a.jpg', phase: 'ended',
      countdown: { text: 'Ended 21 Aug 2026', tone: 'ended' }, highBid: '169,000 sats', startingBid: '1,000 sats', bidCount: 19, bidders: 5, seller,
    } });
    expect(texts).toEqual(expect.arrayContaining(['AUCTIONS', '2 / 3', 'Chiefmonkey', 'Ended 21 Aug 2026', 'Winning bid', '169,000 sats', '19 bids · 5 bidders']));
    expect(images).toHaveLength(2); // photo + avatar, cover-fit
    expect(images[0].slice(5)).toEqual([36, 84, 380, 380]); // v0.2.920: bigger text column
  });
  it('product slide: price + stock; avatar falls back to an initial', () => {
    const { ctx, texts } = fakeCtx();
    paintBoard(ctx, { board: 'products', slide: { kind: 'product', title: 'noodles', image: null, price: '15 GBP', stock: '3 in stock', seller: { ...seller, picture: null } } });
    expect(texts).toEqual(expect.arrayContaining(['PRODUCTS', 'noodles', '15 GBP', '3 in stock', 'C', 'No photo']));
    expect(texts).not.toContain('1 / 1');
  });
  it('live auction with no bids shows the starting bid and singulars', () => {
    const { ctx, texts } = fakeCtx();
    paintBoard(ctx, { board: 'auctions', slide: { kind: 'auction', title: 't', phase: 'live', countdown: { text: 'Ends in 1h 00m', tone: 'live' }, highBid: '', startingBid: '1,000 sats', bidCount: 1, bidders: 1, seller } });
    expect(texts).toEqual(expect.arrayContaining(['Starting bid', '1,000 sats', '1 bid · 1 bidder']));
  });
  it('empty boards', () => {
    const a = fakeCtx(); paintBoard(a.ctx, { board: 'auctions', slide: null });
    expect(a.texts).toContain('No auctions yet');
    const p = fakeCtx(); paintBoard(p.ctx, { board: 'products', slide: null });
    expect(p.texts).toContain('No products yet');
    expect(BOARD_W / BOARD_H).toBeCloseTo(16 / 9, 2);
  });
  it('wrapLines: fits width, ellipsises overflow', () => {
    const { ctx } = fakeCtx(); ctx.font = '20px x'; // 10px/char
    expect(wrapLines(ctx, 'aaa bbb ccc', 75, 2)).toEqual(['aaa bbb', 'ccc']);
    const l = wrapLines(ctx, 'aaa bbb ccc ddd eee', 75, 2);
    expect(l).toHaveLength(2); expect(l[1].endsWith('…')).toBe(true);
  });
});

describe('ownerBoards: world-wanted data feed', () => {
  beforeEach(() => { vi.resetModules(); });
  it('the world boards get data without the HUD panels; stop only when neither wants it', async () => {
    const subs = [];
    vi.doMock('../../src/engine/plebeian/plebeianRelay.js', async (orig) => ({ ...(await orig()), subscribeByAuthor: (o) => { const s = { o, closed: false, close() { this.closed = true; } }; subs.push(s); return s; } }));
    globalThis.window = { __toriiHostPubkey: SELLER };
    globalThis.document = { getElementById: () => null };
    const ob = await import('../../src/engine/plebeian/ownerBoards.js');
    const seen = [];
    const off = ob.onOwnerBoardsData((d) => seen.push(d));
    expect(seen).toHaveLength(1); // called now
    ob.setBoardsWorldWanted(true);
    expect(subs.length).toBeGreaterThan(0);
    expect(ob._ownerBoardsState().worldWanted).toBe(true);
    ob.setBoardsActive(true); ob.setBoardsActive(false); // panels closing must not stop the world feed
    expect(subs.every((s) => !s.closed)).toBe(true);
    ob.setBoardsWorldWanted(false);
    expect(subs.every((s) => s.closed)).toBe(true);
    off(); delete globalThis.window; delete globalThis.document;
  });
});

describe('wiring', () => {
  const rt = readFileSync(new URL('../../src/arenaRuntime.js', import.meta.url), 'utf8');
  const m3 = readFileSync(new URL('../../src/engine/plebeian/marketBoards3d.js', import.meta.url), 'utf8');
  const psm = readFileSync(new URL('../../src/engine/world/proofSurfaceMeshes.js', import.meta.url), 'utf8');
  it('boards are created right after the legacy arena build', () => {
    expect(rt).toMatch(/buildArena\(undefined, _homePlan\.plan\);\n(?:[^\n]*\n){1,2}\s*initMarketBoards3d\(\{ scene, getBoard: getProofSurfaceBoard/);
  });
  it('ticked from the NAP branch; auction board has its own Q prompt and Q falls through to it', () => {
    expect(rt).toMatch(/setNapMode\(_inNapNow\);\n\s*tickMarketBoards3d\(dt, playerObj\.position, _inNapNow\);/);
    expect(rt).toMatch(/promptText: shouldEnableTouch\(\) \? 'Tap VIEW to see auctions' : 'Press Q to view auctions'/);
    expect(rt).toMatch(/if \(marketBoardHas\('auctions'\)\) _auctionBoardTrigger\.tick\(playerObj\.position\);/);
    expect(rt).toMatch(/if \(!_productPanelTrigger\.interact\(\)\) _auctionBoardTrigger\.interact\(\);/);
    expect(rt).toMatch(/_auctionBoardTrigger\.reset\(\);/);
    expect(rt).toMatch(/window\.ToriiDebug\.marketBoards = marketBoards3dState/);
  });
  it('twin board shares geometry (no deep clone → no copied stickers); images https + anonymous CORS; capped cache', () => {
    expect(m3).not.toMatch(/\.clone\(true\)/);
    expect(m3).toMatch(/new THREE\.Mesh\(src\.board\.geometry/);
    expect(m3).toMatch(/crossOrigin = 'anonymous'/);
    expect(m3).toMatch(/IMAGE_CACHE_MAX = 32/);
    expect(m3).toMatch(/kinds: \[PLEBEIAN_BID_KIND\], '#e': ids/);
  });
  it('proof surfaces expose built boards by id', () => {
    expect(psm).toMatch(/export function getProofSurfaceBoard\(id\)/);
    expect(psm).toMatch(/_boards\.set\(panel\.id, \{ board, plate \}\)/);
  });
});

// ── v0.2.920: mobile readability, touch VIEW button, saved listings ──────────
describe('v0.2.920 saved listings', () => {
  const sellerHex = 'ec'.repeat(32);
  const P = { kind: 'product', id: 'p1', title: 'noodles', image: 'https://img.example/p.jpg', price: '15 GBP', stock: '3 in stock', seller: { pubkey: sellerHex, name: 'Chiefmonkey', picture: 'https://img.example/me.png' } };
  const A = { kind: 'auction', id: 'a1', aTag: '30408:x:a1', title: 'Art', image: null, phase: 'ended', endAt: NOW - 10, startAt: NOW - 100,
    countdown: { text: 'Ended 21 Aug 2026', tone: 'ended' }, highBid: '169,000 sats', startingBid: '1,000 sats', bidCount: 19, bidders: 5, seller: P.seller };
  it('round-trips, owner-scoped, expires, and refuses oversize', () => {
    const json = serializeBoardCache({ owner: sellerHex, products: [P], auctions: [A] }, NOW);
    expect(parseBoardCache(json, NOW + 60, sellerHex)).toMatchObject({ owner: sellerHex, products: [P], auctions: [A] });
    expect(parseBoardCache(json, NOW + 60, 'ab'.repeat(32))).toBeNull();          // another owner
    expect(parseBoardCache(json, NOW + BOARD_CACHE_MAX_AGE_S + 1, sellerHex)).toBeNull(); // stale
    expect(parseBoardCache(json, NOW - 3600, sellerHex)).toBeNull();               // from the future
    expect(serializeBoardCache({ owner: '', products: [], auctions: [] }, NOW)).toBeNull();
    expect(parseBoardCache('{"v":1,"at":1,' + '"x":"' + 'a'.repeat(BOARD_CACHE_MAX_BYTES) + '"}', 1, '')).toBeNull();
    expect(BOARD_CACHE_KEY).toBe('torii.marketBoards.v1');
  });
  it('untrusted storage is re-validated: bad images, kinds, sellers and junk dropped', () => {
    const evil = JSON.stringify({ v: 1, owner: '', at: NOW, products: [
      { ...P, image: 'javascript:alert(1)', seller: { pubkey: '<script>', name: 'x'.repeat(200), picture: 'http://track.example/p' } },
      { ...P, kind: 'auction' }, null, 'str', { ...P, id: '' },
    ], auctions: [{ ...A, phase: 'pwned', countdown: { text: 'Ends', tone: 'evil' }, bidCount: -3 }] });
    const c = parseBoardCache(evil, NOW, '');
    expect(c.products).toHaveLength(1);
    expect(c.products[0].image).toBeNull();
    expect(c.products[0].seller).toEqual({ pubkey: '', name: 'x'.repeat(31) + '…', picture: null });
    expect(c.auctions[0]).toMatchObject({ phase: 'ended', countdown: { tone: 'ended' }, bidCount: 0 });
    for (const bad of ['', 'not json', '{"v":2,"at":1}', '[]', null]) expect(parseBoardCache(bad, NOW, '')).toBeNull();
  });
  it('merge: hold keeps saved slides + bid totals until live catches up; seller name borrowed', () => {
    expect(mergeWithCache([], [P], true)).toEqual([P]);
    expect(mergeWithCache([], [P], false)).toEqual([]);
    const liveA = { ...A, highBid: '', bidCount: 0, bidders: 0, seller: { pubkey: sellerHex, name: sellerHex.slice(0, 8), picture: null } };
    const held = mergeWithCache([liveA], [A], true)[0];
    expect(held).toMatchObject({ highBid: '169,000 sats', bidCount: 19, bidders: 5, seller: { name: 'Chiefmonkey', picture: P.seller.picture } });
    const after = mergeWithCache([liveA], [A], false)[0];
    expect(after.bidCount).toBe(0);                 // after the hold, live wins
    expect(after.seller.name).toBe('Chiefmonkey');  // profile still borrowed
  });
});

describe('v0.2.920 mobile readability + touch wording', () => {
  const seller = { pubkey: 'ec'.repeat(32), name: 'Chiefmonkey', picture: null };
  const fontsOf = (ctx) => { const sizes = []; const d = Object.getOwnPropertyDescriptor(ctx, 'font'); let f = ''; Object.defineProperty(ctx, 'font', { get: () => f, set: (v) => { f = v; sizes.push(parseInt(/(\d+)px/.exec(v)[1], 10)); d.set(v); } }); return sizes; };
  it('big type: price ≥ 72px, title ≥ 46px, bid totals 34px', () => {
    const { ctx, texts } = fakeCtx(); const sizes = fontsOf(ctx);
    paintBoard(ctx, { board: 'products', slide: { kind: 'product', title: 'noodles', image: null, price: '15 GBP', stock: '3 in stock', seller } });
    expect(Math.max(...sizes)).toBeGreaterThanOrEqual(72);
    expect(sizes).toContain(52);
    expect(texts).not.toContain('Seller');
  });
  it('long amounts shrink to fit the column instead of overflowing', () => {
    const { ctx } = fakeCtx();
    expect(fitFont(ctx, '15 GBP', 800, 96, 544)).toBe(96);
    const px = fitFont(ctx, '21,000,000,000 sats', 800, 80, 544);
    expect(px).toBeLessThan(80);
    ctx.font = `800 ${px}px x`; expect(ctx.measureText('21,000,000,000 sats').width).toBeLessThanOrEqual(544);
    expect(fitFont(ctx, 'x'.repeat(500), 800, 80, 544)).toBe(48); // floor = 60%
  });
  it('touch footers say Tap VIEW; saved listings say so honestly', () => {
    const a = fakeCtx(); paintBoard(a.ctx, { board: 'auctions', touch: true, slide: { kind: 'auction', title: 't', phase: 'live', countdown: { text: 'Ends in 1h 00m', tone: 'live' }, highBid: '', startingBid: '1 sats', bidCount: 0, bidders: 0, seller } });
    expect(a.texts).toContain('Tap VIEW for bids · bid on Plebeian Market');
    const p = fakeCtx(); paintBoard(p.ctx, { board: 'products', cached: true, slide: { kind: 'product', title: 'n', image: null, price: '1 GBP', stock: '', seller } });
    expect(p.texts).toContain('Saved listings · updating…');
    const d = fakeCtx(); paintBoard(d.ctx, { board: 'products', slide: { kind: 'product', title: 'n', image: null, price: '1 GBP', stock: '', seller } });
    expect(d.texts).toContain('Press Q for details · buy on Plebeian Market');
  });
});

describe('v0.2.920 touch VIEW button wiring', () => {
  const tc = readFileSync(new URL('../../src/engine/input/touchControls.js', import.meta.url), 'utf8');
  const rt = readFileSync(new URL('../../src/arenaRuntime.js', import.meta.url), 'utf8');
  const m3 = readFileSync(new URL('../../src/engine/plebeian/marketBoards3d.js', import.meta.url), 'utf8');
  it('USE button sends KeyQ and only shows with a label', () => {
    expect(tc).toMatch(/button\('\.tb-use', \(\) => _key\('keydown', 'KeyQ'\), \(\) => _key\('keyup', 'KeyQ'\)\)/);
    expect(tc).toMatch(/#torii-touch \.tb-use\{[^}]*display:none/);
    expect(tc).toMatch(/useBtn\.classList\.toggle\('on', !!t\)/);
  });
  it('label: CLOSE while panels open, VIEW in range of either board', () => {
    expect(rt).toMatch(/useLabel: \(\) => \(isMarketActive\(\) \? 'CLOSE'/);
    expect(rt).toMatch(/\(marketBoardHas\('products'\) && _productPanelTrigger\.inRange\(\)\) \|\| \(marketBoardHas\('auctions'\) && _auctionBoardTrigger\.inRange\(\)\)\) \? 'VIEW'/);
    expect(rt).toMatch(/promptText: 'Tap VIEW to see products'/);
    expect(rt).toMatch(/touch: shouldEnableTouch\(\), products: _homeHas\('market\.products'\)/);
  });
  it('saved listings: loaded at build, saved at most every 5 s, never with setTimeout', () => {
    expect(m3).toMatch(/_saved = _loadSaved\(\);/);
    expect(m3).toMatch(/SAVE_EVERY_MS = 5000/);
    expect(m3).not.toMatch(/setTimeout|setInterval/);
  });
});
