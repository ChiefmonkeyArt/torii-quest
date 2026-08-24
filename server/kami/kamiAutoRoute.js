// server/kami/kamiAutoRoute.js — ADR-0055. Pure helpers for POST /mp/kami/autocap.
//
// The batch shape is the SAME as /mp/kami/ema ({v:1, batch:[{id, ema, shot?}]}) so
// validateKamiBatch is REUSED — only the store differs. Each frame is ONE file
// {ema, shot} ring-culled to 120 (a TRUE ring: no unbounded append-only index).

/** Validate + store an auto-capture batch. Writes one {ema, shot} JSON file per
 *  frame to the autocap ring, culls back to the cap. Returns counts. Never
 *  inspects sealed contents. */
export async function storeAutoCapBatch(batch, admin, autoStore) {
  let stored = 0, frames = 0, culled = 0;
  for (const item of batch) {
    const record = { id: item.id, ts: Date.now(), requester: admin, ema: item.sealedEma, shot: item.shot ? { env: item.shot.env, bytes: item.shot.bytes || 0 } : null };
    await autoStore.writeFrame(item.id, JSON.stringify(record));
    stored += 1;
    if (item.shot) frames += 1;
  }
  if (stored > 0) culled = (await autoStore.cullFrames()).length;
  return { stored, frames, culled };
}
