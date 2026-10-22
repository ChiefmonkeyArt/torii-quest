// engine/plebeian/marketBoardPainter.js — ADR-0145 (v0.2.919): paints ONE
// market-board slide onto a 2D canvas context (the in-world board's texture).
// No THREE, no network: images come from an injected `getImage(url)` that
// returns a ready HTMLImageElement/ImageBitmap or null (then a placeholder is
// drawn). Fixed canvas size → fixed GPU memory, however big the source photo.
export const BOARD_W = 1024;
export const BOARD_H = 576; // the plate is ~16:9 (2.208 × 1.248 m)

const BG = '#0a141a', PANEL = '#12232b', INK = '#e8f6f4', MUTED = '#9fc7c2', ORANGE = '#f7931a';
const TONE = { live: '#2bd67b', soon: '#ff5a4e', upcoming: '#5ab4ff', ended: '#4a5a60' };
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif';

function hue(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; }

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Word-wrap into at most `maxLines` lines that fit `width`. */
export function wrapLines(ctx, text, width, maxLines) {
  const words = String(text || '').split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (ctx.measureText(next).width <= width || !cur) cur = next;
    else { lines.push(cur); cur = w; if (lines.length === maxLines) break; }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
    let last = lines[maxLines - 1];
    while (last.length > 1 && ctx.measureText(last + '…').width > width) last = last.slice(0, -1);
    lines[maxLines - 1] = last.replace(/\s+$/, '') + '…';
  }
  return lines.slice(0, maxLines);
}

/** Cover-fit an image into a box (crop, no stretch). */
function drawCover(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!(iw > 0 && ih > 0)) return false;
  const s = Math.max(w / iw, h / ih), sw = w / s, sh = h / s;
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
  return true;
}

function avatar(ctx, seller, getImage, cx, cy, r) {
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
  const img = seller.picture ? getImage(seller.picture) : null;
  if (!(img && drawCover(ctx, img, cx - r, cy - r, r * 2, r * 2))) {
    ctx.fillStyle = `hsl(${hue(seller.pubkey || seller.name || '?')} 55% 42%)`;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = INK; ctx.font = `700 ${Math.round(r)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText((seller.name || '?').slice(0, 1).toUpperCase(), cx, cy + 1);
  }
  ctx.restore();
  ctx.strokeStyle = ORANGE; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
}

function header(ctx, title, index, count) {
  ctx.fillStyle = ORANGE; ctx.fillRect(0, 0, BOARD_W, 6);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillStyle = ORANGE; ctx.font = `800 36px ${FONT}`;
  ctx.fillText(title, 36, 44);
  if (count > 1) {
    ctx.textAlign = 'right'; ctx.fillStyle = MUTED; ctx.font = `700 30px ${FONT}`;
    ctx.fillText(`${index + 1} / ${count}`, BOARD_W - 36, 44);
  }
}

function footer(ctx, text) {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = MUTED; ctx.font = `600 26px ${FONT}`;
  ctx.fillText(text, BOARD_W / 2, BOARD_H - 24);
}

/**
 * Paint `slide` (from marketBoardModel) — or the empty state when null.
 * @param {'products'|'auctions'} board
 */
export function paintBoard(ctx, { board, slide, index = 0, count = 0, getImage = () => null, touch = false, cached = false }) {
  // v0.2.920: saved listings show until the live ones arrive (honest footer).
  const status = cached ? 'Saved listings · updating…' : '';
  ctx.fillStyle = BG; ctx.fillRect(0, 0, BOARD_W, BOARD_H);
  header(ctx, board === 'auctions' ? 'AUCTIONS' : 'PRODUCTS', index, count);

  if (!slide) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = INK; ctx.font = `800 56px ${FONT}`;
    ctx.fillText(board === 'auctions' ? 'No auctions yet' : 'No products yet', BOARD_W / 2, BOARD_H / 2 - 24);
    ctx.fillStyle = MUTED; ctx.font = `600 32px ${FONT}`;
    ctx.fillText('Listings from Plebeian Market appear here', BOARD_W / 2, BOARD_H / 2 + 38);
    footer(ctx, 'Torii NAP Zone market · watch-only');
    return;
  }

  // Photo (left). v0.2.920: smaller photo, bigger text column (phones).
  const px = 36, py = 84, pw = 380, ph = 380;
  ctx.fillStyle = PANEL; roundRect(ctx, px, py, pw, ph, 18); ctx.fill();
  const img = slide.image ? getImage(slide.image) : null;
  ctx.save(); roundRect(ctx, px, py, pw, ph, 18); ctx.clip();
  if (!(img && drawCover(ctx, img, px, py, pw, ph))) {
    ctx.fillStyle = MUTED; ctx.font = `600 30px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(slide.image ? 'Loading photo…' : 'No photo', px + pw / 2, py + ph / 2);
  }
  ctx.restore();

  // Seller row: avatar + name (no label: the avatar ring says "seller")
  const rx = 444, rw = BOARD_W - rx - 36;
  avatar(ctx, slide.seller, getImage, rx + 32, 116, 32);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = INK; ctx.font = `700 34px ${FONT}`;
  ctx.fillText(wrapLines(ctx, slide.seller.name, rw - 80, 1)[0] || '', rx + 80, 118);

  const auction = slide.kind !== 'product';
  const tPx = auction ? 46 : 52, tLh = tPx + 8;
  ctx.fillStyle = INK; ctx.font = `800 ${tPx}px ${FONT}`; ctx.textBaseline = 'top';
  const lines = wrapLines(ctx, slide.title, rw, 2);
  lines.forEach((l, i) => ctx.fillText(l, rx, 166 + i * tLh));
  let y = 166 + lines.length * tLh + 14;

  if (!auction) {
    ctx.fillStyle = ORANGE; ctx.font = `800 ${fitFont(ctx, slide.price, 800, 96, rw)}px ${FONT}`;
    ctx.fillText(slide.price, rx, y); y += 112;
    if (slide.stock) { ctx.fillStyle = MUTED; ctx.font = `600 36px ${FONT}`; ctx.fillText(slide.stock, rx, y); }
    footer(ctx, status || (touch ? 'Tap VIEW for details' : 'Press Q for details') + ' · buy on Plebeian Market');
    return;
  }

  // Auction: countdown chip, high bid, bid totals
  const c = slide.countdown || { text: '', tone: 'ended' };
  ctx.font = `800 34px ${FONT}`;
  const cw = Math.min(rw, ctx.measureText(c.text).width + 44);
  ctx.fillStyle = TONE[c.tone] || TONE.ended; roundRect(ctx, rx, y, cw, 56, 28); ctx.fill();
  ctx.fillStyle = c.tone === 'ended' ? INK : BG; ctx.textBaseline = 'middle'; ctx.fillText(c.text, rx + 22, y + 29);
  y += 76;
  ctx.textBaseline = 'top';
  ctx.fillStyle = MUTED; ctx.font = `600 28px ${FONT}`;
  ctx.fillText(slide.highBid ? (slide.phase === 'ended' ? 'Winning bid' : 'High bid') : 'Starting bid', rx, y); y += 34;
  const amount = slide.highBid || slide.startingBid;
  ctx.fillStyle = ORANGE; ctx.font = `800 ${fitFont(ctx, amount, 800, 80, rw)}px ${FONT}`;
  ctx.fillText(amount, rx, y); y += 82;
  ctx.fillStyle = INK; ctx.font = `700 34px ${FONT}`;
  const bids = `${slide.bidCount} bid${slide.bidCount === 1 ? '' : 's'}`;
  const who = slide.bidders ? ` · ${slide.bidders} bidder${slide.bidders === 1 ? '' : 's'}` : '';
  ctx.fillText(bids + who, rx, y);
  footer(ctx, status || (touch ? 'Tap VIEW for bids' : 'Press Q for bids') + ' · bid on Plebeian Market');
}

/** Largest font size (≤ maxPx, ≥ 60% of it) at which `text` fits `width`. */
export function fitFont(ctx, text, weight, maxPx, width) {
  const min = Math.round(maxPx * 0.6);
  for (let px = maxPx; px > min; px -= 4) {
    ctx.font = `${weight} ${px}px ${FONT}`;
    if (ctx.measureText(String(text || '')).width <= width) return px;
  }
  return min;
}
