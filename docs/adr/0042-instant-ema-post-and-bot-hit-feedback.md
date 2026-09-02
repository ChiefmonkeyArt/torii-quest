# ADR-0042: Instant Ema Post on Enter + Visible Bot Hit Feedback

- **Status:** Accepted
- **Date:** 2026-08-24
- **Deciders:** chiefmonkey
- **Related:** ADR-0025 (ema sealed box), ADR-0029 (Kami state machine), ADR-0034 (note bar), ADR-0041 (playtest exit + hit feedback)

## Context

Round-2 playtest feedback from the owner surfaced two concrete gaps:

1. **Ema hang needed a redundant step.** After typing an ema note, the owner had
   to press Enter (which only staged the note locally as "pending") and then
   press Shift+K separately to actually seal + POST it to the VPS. When the
   VPS write failed with EROFS (the `torii-arena-ws.service` unit runs
   `ProtectSystem=strict` + `ReadWritePaths=/opt/torii-quest/mp` only, so
   `/var/lib/torii-quest/kami` was read-only to the service), the owner saw
   "hang failed" with no path forward. The owner's ask: "when I create an ema
   and hit return it should just hang on the emagake and on the VPS instantly…
   no need for extra step and pressing shift+k again."

2. **Bots showed no visible reaction to hits.** The server's authoritative
   combat DID register hits (journal showed `botHit=4@body`, `botHit=0@head`,
   etc.), but the bot had no visual response — no flash, no health indicator, no
   death animation. The owner fired stickers at bots that did not appear to
   connect.

The EROFS root cause was fixed and verified earlier this session via a systemd
drop-in (`/etc/systemd/system/torii-arena-ws.service.d/kami-ema.conf` adding
`ReadWritePaths=/opt/torii-quest/mp /var/lib/torii-quest/kami`). This ADR
covers the client UX + bot visual feedback built on top of that fix.

## Decision

### 1. Enter seals + POSTs instantly (no Shift+K required)

Extracted the reusable `sealAndPost(records)` from `hangTray()` in
`src/engine/kami/kamiMode.js`. `finish(true)` (the Enter handler on the note
textarea) now calls `sealAndPost([rec])` immediately — the note is marked
`PENDING`, added to the rack, rendered, then the seal+POST fires
fire-and-forget. On success the note flips to `SENT` ("HUNG 1"); on failure it
flips to `FAILED` ("HANG FAILED — RETRY SHIFT+K") and **stays on the rack**.

A new `POST_STATE` (`pending` / `sent` / `failed`) lives in
`src/engine/kami/emaModel.js`. The emagake panel renders a `SENDING` tag for
pending notes and a `RETRY` tag for failed ones. `evictOldestSent(tray)` makes
room when the rack is full by evicting the oldest already-hung (SENT) note —
pending/failed notes are never evicted.

**Shift+K is now the retry path only:** `hangTray()` re-seals + re-POSTs every
note still `pending` or `failed`. The badge reads "N EMA ON THE RACK · ENTER
HANGS · SHIFT+K RETRIES". The empty-rack hint reads "ENTER TO HANG · SHIFT+K
RETRIES".

### 2. Bot hit visuals: red flash + HP chip + death anim

In `src/botModel.js`:
- `init()` collects every mesh material with an `emissive` channel into
  `this._materials`.
- `flashHit(intensity=1.1)` tints every collected material's emissive red
  (`0xff3030`) for a 0.18s window, storing the original emissive on
  `m.userData._origEmissive`.
- `tick(dt)` decays the flash back to the original emissive once the window
  elapses. The decay runs **before** the mixer guard so a flash still fades
  even if the animation mixer isn't ready.
- `updateNameplate(text, hpRatio)` redraws the nameplate canvas with the bot
  name + an HP bar (green→red by `hpRatio`).

In `src/bots.js`:
- `applyBotHit()` now calls `bot.model?.flashHit()` +
  `bot.model?.updateNameplate(name, hp/maxHp)` on every server-confirmed hit.
- `applyBotKill()` sets `hp=0`, flashes, and redraws the nameplate at 0 HP.
- The render loop passes `!st.alive` as the death flag (previously hardcoded
  `false`, so the death animation never played) and decays `_isHit`/`_hitTimer`
  so a bot that was hit then survives drops the flinch state.

### 3. Stickers do not stick to bots — by design

Bot meshes carry `root.userData.isBotMesh = true` (`src/botModel.js`) and are
excluded from the sticker decal Three.js raycaster. Stickers adhere to world
geometry + player skins, not to animated bot SkinnedMesh surfaces (adhering
decals to a deforming skinned mesh is a hard, separate problem — ADR it, do
not fake it). **The red flash + HP chip + death anim ARE the hit feedback.**
This is explicitly not claimed as a sticker-on-bot fix.

### 4. sealTo realm-agnostic byte check

`src/engine/kami/kamiSeal.js` `sealTo()` relaxed its payload guard from
`instanceof Uint8Array` to a realm-agnostic `typeof payload.byteLength ===
'number'` check. A `Uint8Array` produced in another realm (browser iframe/
worker, or the vitest jsdom context) fails `instanceof Uint8Array` because the
constructor references differ; any TypedArray/DataView/ArrayBuffer carries a
numeric `byteLength`, which is all `subtle.encrypt` needs (it accepts any
`BufferSource`). This is a genuine cross-realm robustness improvement, not a
test-only patch.

## Consequences

- **Enables:** The owner hangs an ema with one keystroke (Enter) and sees it
  on the VPS immediately; a failed POST is recoverable with Shift+K without
  retyping. Hits on bots are now visible (red flash + HP bar + death), closing
  the gap between server-confirmed damage and player perception.
- **Forecloses:** Sticker decals on bot meshes are out of scope; do not claim
  they stick to bots.
- **Trade-offs:** Enter no longer inserts a newline in the ema textarea (Enter
  commits; Shift+Enter inserts a newline). The seal is still fire-and-forget
  on Enter, so a transient network failure leaves the note `FAILED` until
  Shift+K retries — acceptable since the note is never lost.
- **Enforcement:**
  - `tests/kami/ema-model.test.js` — `evictOldestSent` + `POST_STATE`.
  - `tests/kami/emagake-reply-render.test.js` — `SENDING`/`RETRY` tag render.
  - `tests/kami/kami-ema-instant-post.test.js` — Enter POSTs once; failed POST
    keeps the note; Shift+K retries. Drives the real `installKamiMode` with a
    fake fetch; the seal is mocked (its crypto is locked down separately in
    `kami-seal.test.js`) + the pointer-lock capture path is used so no
    `document.elementFromPoint` / `globalThis.crypto` global leaks into sibling
    test files under `poolOptions.threads.isolate:false`.
  - `tests/bot-model-flash.test.js` — `flashHit` tints red; `tick` decays to
    the original emissive; no-op without materials.
  - `__resetKamiForTests()` export resets module-level state so kamiMode tests
    don't leak `_armed`/`_noteOpen`/`_tray` across files under
    `poolOptions.threads.isolate:false`.

## Alternatives considered

- **Keep Shift+K as the only post path.** Rejected — the owner explicitly asked
  to drop the extra step.
- **Auto-retry failed POSTs on a timer.** Rejected — silent background retries
  on an unattended timer are surprising; an explicit Shift+K retry keeps the
  owner in control.
- **Adhere stickers to bot SkinnedMesh surfaces.** Rejected for this milestone
  — hard problem, deferred. The flash+HP+death feedback covers the perception
  gap without it.
- **Mock the seal entirely in the instant-post test.** Adopted — the seal
  crypto is already locked down in `tests/kami/kami-seal.test.js`, so the
  instant-post test mocks `sealJson`/`sealTo` (no WebCrypto / `globalThis.crypto`
  override needed) and proves only the `sealAndPost` wiring: Enter triggers one
  POST, a failed POST keeps the note, Shift+K retries. This also avoids leaking
  jsdom-only global overrides into sibling test files.
