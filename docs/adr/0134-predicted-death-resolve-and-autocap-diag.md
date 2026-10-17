# ADR-0134: Predicted deaths always resolve; diagnostic access to the autocap ring

- **Status:** Accepted
- **Date:** 2026-10-17
- **Deciders:** chiefmonkey (play-test 2026-10-17: "the big bot is stuck on the ground Augustine is lying down"; "if you can get it so that you are able to see the images caught during in-game that would be great… these images are not sensitive").
- **Builds on:** ADR-0131 (combat feel: predicted kills), ADR-0055 (1 Hz autocap ring), ADR-0102 (admin dispatcher).
- **Scope:** the Game Zone client prediction, plus an owner-approved diagnostics path. Points and damage are unchanged.

## Context

**Boss lying on the ground, alive.** A shot the client judges lethal plays the death clip at once (`predictDeath`) and waits for the authority. Two faults could leave a bot lying down forever:

1. The lethal test was `v.hp − pending − dmg ≤ 0`, but `v.hp` is the displayed hp, which already has the pending damage taken off. Unanswered damage counted twice, so sustained fire on the 60 HP boss predicted its death after about half its hp.
2. `_onResult` only stood the bot back up when the shot did not land. A shot that landed but did not kill, such as a head claim downgraded to body or the boss's large hp, left `predictedDead` set. The pending entry was gone, so the TTL path never fired either. The bot kept its die pose with no nameplate, ignored `setAnim`, and never stood up.

**Captures unreadable.** The 1 Hz autocap ring is sealed to the owner and Kami, and is stored in `/var/lib/torii-quest/kami/autocap`, which is outside the admin read roots. Neither private key is available to a session, so glitches could not be reviewed from the captures.

## Decision

1. **Lethal uses the authoritative hp.** `lethal = row hp − pending − dmg ≤ 0`, where the row hp is the newest snapshot's value (`_authHp`, `_pendingDmg`).
2. **Every result settles a prediction.** Unless the result is a landed kill, `_settlePrediction` stands the bot up when the authoritative hp, minus what is still pending, is above 0.
3. **Safety net.** A predicted death with nothing pending and no kill for longer than `PREDICT_TTL_MS` is settled again (checked every 15 frames). A bot can never stay lying down while alive.
4. **Diagnostics recipient.** Autocap frames, and only autocap frames, are also sealed to `DIAG_PUBKEY` (`src/engine/kami/diagKey.js`). The manual ema notes are not.
   - The private key exists only as the `TORII_DIAG_PRIV` repository secret. It was generated straight into the secret and never stored anywhere else.
   - `.github/workflows/autocap-pull.yml` runs the new fixed, argument-less dispatcher op `torii-admin-run autocap-export` (a tar of the sealed ring's regular `*.json` files; no symlinks; `/var/lib` is still not a read root).
   - The workflow checks that the secret matches `DIAG_PUBKEY`, opens the frames with `tools/kami-autocap-dump.mjs`, and uploads them as a 3-day artifact.
   - Dispatcher v3; the installer's sha256 pin is updated.

## Consequences

- Covered by `tests/gamezone/feel.test.js` (the boss under sustained fire never predicts death early; a landed non-lethal result stands it up; a confirmed kill keeps it down). The first test fails on the old line.
- The operator must reinstall the dispatcher once to enable `autocap-export`, using `ops/install-admin-ssh.sh`, which is hash-pinned. Each operator approves this on their own VPS.
- Only frames captured after v0.2.899-alpha are readable by the diagnostics key; older frames are skipped.
- To revoke, delete the `TORII_DIAG_PRIV` secret. To rotate, create a new keypair, then update the secret and `DIAG_PUBKEY`.
