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
  ctx.fillStyle = ORANGE; ctx.font = `800 30px ${FONT}`;
  ctx.fillText(title, 40, 42);
  if (count > 1) {
    ctx.textAlign = 'right'; ctx.fillStyle = MUTED; ctx.font = `600 24px ${FONT}`;
    ctx.fillText(`${index + 1} / ${count}`, BOARD_W - 40, 42);
  }
}

function footer(ctx, text) {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = MUTED; ctx.font = `500 22px ${FONT}`;
  ctx.fillText(text, BOARD_W / 2, BOARD_H - 26);
}

/**
 * Paint `slide` (from marketBoardModel) — or the empty state when null.
 * @param {'products'|'auctions'} board
 */
export function paintBoard(ctx, { board, slide, index = 0, count = 0, getImage = () => null }) {
  ctx.fillStyle = BG; ctx.fillRect(0, 0, BOARD_W, BOARD_H);
  header(ctx, board === 'auctions' ? 'AUCTIONS' : 'PRODUCTS', index, count);

  if (!slide) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = INK; ctx.font = `700 46px ${FONT}`;
    ctx.fillText(board === 'auctions' ? 'No auctions yet' : 'No products yet', BOARD_W / 2, BOARD_H / 2 - 20);
    ctx.fillStyle = MUTED; ctx.font = `500 26px ${FONT}`;
    ctx.fillText('Listings from Plebeian Market appear here', BOARD_W / 2, BOARD_H / 2 + 34);
    footer(ctx, 'Torii NAP Zone market · watch-only');
    return;
  }

  // Photo (left)
  const px = 40, py = 78, pw = 420, ph = 420;
  ctx.fillStyle = PANEL; roundRect(ctx, px, py, pw, ph, 18); ctx.fill();
  const img = slide.image ? getImage(slide.image) : null;
  ctx.save(); roundRect(ctx, px, py, pw, ph, 18); ctx.clip();
  if (!(img && drawCover(ctx, img, px, py, pw, ph))) {
    ctx.fillStyle = MUTED; ctx.font = `600 28px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(slide.image ? 'Loading photo…' : 'No photo', px + pw / 2, py + ph / 2);
  }
  ctx.restore();

  // Seller row
  const rx = 496, rw = BOARD_W - rx - 40;
  avatar(ctx, slide.seller, getImage, rx + 30, 112, 30);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = MUTED; ctx.font = `500 22px ${FONT}`;
  ctx.fillText('Seller', rx + 76, 98);
  ctx.fillStyle = INK; ctx.font = `700 28px ${FONT}`;
  ctx.fillText(wrapLines(ctx, slide.seller.name, rw - 76, 1)[0] || '', rx + 76, 128);

  // Title
  ctx.fillStyle = INK; ctx.font = `800 40px ${FONT}`; ctx.textBaseline = 'top';
  const lines = wrapLines(ctx, slide.title, rw, 2);
  lines.forEach((l, i) => ctx.fillText(l, rx, 170 + i * 48));
  let y = 170 + lines.length * 48 + 18;

  if (slide.kind === 'product') {
    ctx.fillStyle = ORANGE; ctx.font = `800 64px ${FONT}`; ctx.fillText(slide.price, rx, y); y += 82;
    if (slide.stock) { ctx.fillStyle = MUTED; ctx.font = `600 28px ${FONT}`; ctx.fillText(slide.stock, rx, y); }
    footer(ctx, 'Press Q for details · buy on Plebeian Market');
    return;
  }

  // Auction: countdown chip, high bid, bid totals
  const c = slide.countdown || { text: '', tone: 'ended' };
  ctx.font = `800 30px ${FONT}`;
  const cw = Math.min(rw, ctx.measureText(c.text).width + 40);
  ctx.fillStyle = TONE[c.tone] || TONE.ended; roundRect(ctx, rx, y, cw, 50, 25); ctx.fill();
  ctx.fillStyle = c.tone === 'ended' ? INK : BG; ctx.textBaseline = 'middle'; ctx.fillText(c.text, rx + 20, y + 26);
  y += 74;
  ctx.textBaseline = 'top';
  ctx.fillStyle = MUTED; ctx.font = `600 24px ${FONT}`;
  ctx.fillText(slide.highBid ? (slide.phase === 'ended' ? 'Winning bid' : 'High bid') : 'Starting bid', rx, y); y += 32;
  ctx.fillStyle = ORANGE; ctx.font = `800 56px ${FONT}`;
  ctx.fillText(slide.highBid || slide.startingBid, rx, y); y += 70;
  ctx.fillStyle = INK; ctx.font = `600 28px ${FONT}`;
  const bids = `${slide.bidCount} bid${slide.bidCount === 1 ? '' : 's'}`;
  const who = slide.bidders ? ` · ${slide.bidders} bidder${slide.bidders === 1 ? '' : 's'}` : '';
  ctx.fillText(bids + who, rx, y);
  footer(ctx, 'Press Q for bids · bid on Plebeian Market');
}
