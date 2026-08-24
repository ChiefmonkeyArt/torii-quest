// server/kami/kamiAutoRoute.js — ADR-0055. Pure helpers for POST /mp/kami/autocap.
//
// The batch shape is the SAME as /mp/kami/ema ({v:1, batch:[{id, ema, shot?}]}) so
// validateKamiBatch is REUSED — only the store + cap differ (auto-capture ring at
// 120, separate from the manual ema shots ring at 420 and the forever ema.jsonl).

import { autoCapLine } from './kamiAutoStore.js';

/** Validate + store an auto-capture batch. Appends each index line to
 *  autocap.jsonl, writes each sealed frame to the ring, culls back to the cap.
 *  Returns counts. Never inspects sealed contents. */
export async function storeAutoCapBatch(batch, admin, autoStore) {
  const now = Date.now();
  let stored = 0, frames = 0, culled = 0;
  for (const item of batch) {
    const shotId = item.shot ? `${item.id}.jpg` : null;
    await autoStore.appendIndex(autoCapLine({
      id: item.id,
      ts: now,
      requester: admin,
      sealedEma: item.sealedEma,
      shotId,
    }));
    stored += 1;
    if (item.shot) {
      await autoStore.writeFrame(item.id, JSON.stringify(item.shot.env));
      frames += 1;
    }
  }
  if (frames > 0) culled = (await autoStore.cullFrames()).length;
  return { stored, frames, culled };
}
