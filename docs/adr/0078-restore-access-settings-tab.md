# ADR-0078: Restore the Access settings tab (re-surface signed kind:30078 access controls)

- **Status:** Accepted
- **Date:** 2026-08-27
- **Tags:** settings, access-control, UI
- **Supersedes / reverts:** the v0.2.676 removal that hid the Instance Settings admin surface (then described as "nothing useful there for admins or guests").

## Context

The title-screen settings panel (settingsPanel.js, v0.4) shipped four tabs —
Profile, Gateway Setup, Heartbeat, Relay — all functional, none stubbed. Despite
that, the panel read as "a demo" to the operator: it was sparse, and the one
substantial admin surface that already existed (arrival authority + write
authority, backed by the signed kind:30078 settings event) had been **hidden**
since v0.2.676. The underlying enforcement (handoffArrival.js / writeAuthority.js)
+ the read/publish helpers (readLatestAccessSettings / publishAccessSettings in
nostr.js) stayed live the whole time it was hidden — only the editing UI was
gone. instanceSettings.js (the view-model + renderer, built v0.2.358) was left
"unimported, in case the surface returns."

Operator direction: "make the settings panel feel complete + useful" — "just make
whatever there active… it should all be useful stuff." For Bekka logging in
tomorrow, the panel must read as a real product, not a placeholder.

## Decision

**Re-surface the existing access-control surface as a fifth "Access" tab** —
restoring the v0.2.400 wiring rather than building anything new. Concretely:

1. Add `{ id: 'access', label: 'Access' }` to settingsPanel.js `TABS` (foot of
   the nav — it is admin/advanced).
2. main.js re-imports `buildInstanceSettingsModel` / `renderInstanceSettingsPanel`
   / `coerceEditableArrivalMode` / `coerceEditableWritePolicy` from
   instanceSettings.js, and `readLatestAccessSettings` / `publishAccessSettings`
   from nostr.js.
3. Re-add the module-level `_instanceSettingsState` (loading/saving/persisted/
   draft arrival mode + write policy/status) + the unchanged read/save round-trip
   functions recovered verbatim from the v0.2.676-predecessor commit:
   `_syncInstanceSettingsDraft`, `_currentInstanceSettingsModel`,
   `_rerenderInstanceSettingsPanel`, `_refreshInstanceSettingsAccessState`,
   `_saveInstanceSettingsAccess`.
4. Register the `access` tab renderer. It **filters the model's sections to only
   `'access'`** — the module's inert placeholder sections (`'multiplayer'` "MP-1
   ships behind a build-time flag" + `'more'` "More coming soon") are dropped, so
   the tab shows only useful, live controls. The relay read is kicked off lazily
   on the first render (`_readStarted` guard) so opening the tab populates the
   persisted setting.
5. Wire the actions through the existing delegated listeners on
   `#torii-settings-content`: a `change` listener writes the arrival-mode /
   write-policy radio selections into the draft; a `submit` listener handles
   `data-form="access-settings"` → `_saveInstanceSettingsAccess` (signs +
   publishes the kind:30078).

## Consequences

- **The settings panel now reads as complete.** Five tabs, the admin surface
  restored, no "coming soon" placeholders surfaced in the active tab.
- **Enforcement is unchanged + cannot be weakened by the edit surface.** Arrival
  + write authority are owner-only, gated by a signed kind:30078 event verified
  on read before it can affect arrival. Re-surfacing the editing UI only persists
  the operator's choice; it never bypasses the verify-on-read gate.
- **No new sign/publish path.** `publishAccessSettings` reuses the existing
  nostr.js `signEvent` / `fanoutPublish` — the same path the heartbeat + profile
  tabs already use. A signer rejection surfaces a status message (no nag, no
  silent failure).
- **instanceSettings.js is unchanged** (its placeholder sections are filtered at
  the render call site, not removed from the module), so the existing
  instance-settings test suite still pins its behaviour.

## Non-goals (deferred)

Per advisor + the "it should all be useful stuff" constraint, a fake/read-only
tab makes the demo-feel worse, not better. So these are **not** added here:

- **Audio tab** — audio.js has no master volume/mute API (each sound hardcodes its
  gain node). A working Audio tab requires routing the audio system through a
  master gain + exposing `setMasterVolume` / `setMuted`. Deferred until that API
  exists.
- **Graphics tab** — qualityTier.js is auto-adaptive by FPS (no manual override
  setter). A working Graphics tab requires manual-override logic that coexists
  with the auto-tiering. Deferred.
- **Controls/keybinds tab** — no keybind persistence layer yet. Deferred.

## Tests

- `tests/settings-panel.test.js` (new): the tab inventory is
  `[profile, gateway, heartbeat, relay, access]` — pins the Access tab's
  presence + nav order so a future change can't silently drop it.
- `tests/instance-settings.test.js` (extended): when the model's sections are
  filtered to only `access` (as the renderer does), the output contains the live
  arrival/write authority controls + `data-form="access-settings"` /
  `data-action="save-access"`, and does **not** contain `More coming soon`, the
  multiplayer "MP-1 ships behind a build-time flag" note, or
  `data-section="multiplayer"` / `data-section="more"`.

## References

- ADR-0076 (trusted starter relays), ADR-0077 (heartbeat auto-on) — the other
  v0.2.711/v0.2.712 "make it just work" changes.
- The v0.2.676 removal commit `999210b7` (its parent carried the wiring restored
  here).
