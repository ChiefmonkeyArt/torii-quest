// kamiRoute.js — ADR-0025. Pure helpers for the POST /mp/kami/ema route.
//
// Split out of arena-ws.js so the shape-validation and store-loop are unit-testable
// without spinning up an HTTP server. The route handler is a thin wrapper:
// admin-gate (adminFromRequest), body cap (readJsonBodyCapped), then these two.

import { emaLine } from './kamiStore.js';

/** Validate the outer POST shape: {v:1, batch:[{id, ema, shot?}]}.
 *  Returns the batch array (filtered to well-formed entries) or null if the
 *  request is unusable. Never inspects sealed contents. */
export function validateKamiBatch(parsed) {
  if (!parsed || parsed.v !== 1) return null;
  const batch = parsed.batch;
  if (!Array.isArray(batch) || batch.length === 0 || batch.length > 64) return null;
  const clean = [];
  for (const item of batch) {
    const id = item && typeof item.id === 'string' ? item.id : null;
    const sealedEma = item && item.ema && typeof item.ema === 'object' ? item.ema : null;
    if (!id || !sealedEma) continue; // skip a malformed entry, keep the batch
    const shot = item.shot && item.shot.env ? item.shot : null;
    clean.push({ id, sealedEma, shot });
  }
  return clean.length > 0 ? clean : null;
}

/** Store a validated batch. Appends each ema to ema.jsonl forever; writes each
 *  shot to the ring buffer; culls shots back to the cap. Returns counts. */
export async function storeKamiBatch(batch, admin, kamiStore) {
  const now = Date.now();
  let stored = 0, shots = 0, culled = 0;
  for (const item of batch) {
    await kamiStore.appendEma(emaLine({ id: item.id, ts: now, requester: admin, sealedEma: item.sealedEma }));
    stored += 1;
    if (item.shot) {
      await kamiStore.writeShot(item.id, JSON.stringify(item.shot.env));
      shots += 1;
    }
  }
  if (shots > 0) culled = (await kamiStore.cullShots()).length;
  return { stored, shots, culled };
}
