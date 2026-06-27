# Torii Quest — v0.2.233-alpha Handoff / Release Control Panel

**Slice type:** status / dashboard / docs only — **no runtime change.**
**Verdict:** ✅ **SHIP**
**Commit basis:** `f05f4cd`
**Date:** 2026-06-27

---

## 1. What this slice does

Adds a single consolidated **handoff / release control panel** so the next AI
agent or human can open ONE surface and immediately know the live state of the
project, what is safe to do next, and what must NOT be done without the user.

The panel is a **single source of truth** (`src/engine/status/handoffControlPanel.js`,
a pure node-safe module) consumed by BOTH:

- the **Continuum dashboard** (via `continuumData.js` → `build-continuum.mjs`), and
- the **node handoff tools** (`nextActionState.mjs`, `build-continuum.mjs`),

so the green-logic can never drift between the dashboard and the CLI artifacts.

### The panel answers, in one place
1. **Current live version & URLs** — `v0.2.233-alpha`; game
   `https://torii-quest.pplx.app`, dashboard `https://torii-quest.pplx.app/continuum.html`.
2. **Latest entry smoke status** — evidence-gated (pass requires evidence).
3. **Latest dashboard smoke status** — evidence-gated (pass requires evidence).
4. **MVP approval / manual playtest blocker** — `MVP BLOCKER PENDING
   (USER PLAYTEST + OK)`, pill `manual`.
5. **Next safe no-blocker task** — surfaced from the no-blocker queue.
6. **Actions NOT to take without user input** — `HANDOFF_DO_NOT` list.
7. **Project ethics / operating principles** — 11 explicitly **non-religious**,
   practical engineering/product principles.

---

## 2. Ethics / principles (NON-RELIGIOUS)

`PROJECT_PRINCIPLES` is a practical engineering/product compass — **no sacred
language, no doctrine, no preaching, no worship framing.** A
**religious-language guard** (`RELIGIOUS_DENYLIST` + `findReligiousLanguage`)
makes any flagged term a validator **ERROR**, with the brand vocabulary
(`torii` / `gate` / `shrine` / `⛩`) intentionally NOT guarded, and the bare
`god` excluded so it never trips `godMode`.

Principles encoded: self-sovereignty, consent, privacy by default, user-owned
identity/npub, open protocols, FOSS, Bitcoin/Nostr/ecash alignment, local
circular economics, voluntary exchange, no dark patterns / no surveillance /
no coercive monetization / no vendor lock-in, reversible user-controlled
actions, community agency, interoperability, and truthful status reporting.
`ETHICS_NOTE` frames these as a compass, "not dogma".

---

## 3. Strict semantics preserved

The panel **cannot** weaken any existing gate:

- `impliesApproval` / `impliesPlaytestComplete` pinned **false** everywhere.
- **smoke pass ≠ MVP approval**; **dashboard pass ≠ manual playtest**.
- **No live Nostr writes implied** by any status surface.
- **GREEN-REQUIRES-EVIDENCE floor:** a `green`/`pass` verdict is a validator
  ERROR unless current version, live URL, entry-smoke evidence, dashboard-smoke
  evidence, pending-blocker semantics, AND non-religious ethics language are all
  present. The handoff panel test suite asserts the panel cannot go green
  without each of these.

---

## 4. Hard constraints — all honored

- `godMode` remains **false**.
- **No new** `setTimeout` outside existing allowed cases.
- **No new** `Vector3` / `Matrix4` in hot paths.
- Comments use **"nostrich"**; **Chiefmonkey** spelling exact.
- Debug tools ship **unconditionally**.
- **No deploy / publish / push** performed — left to the main agent.
- CSP unchanged: dashboard still has a single inline script; sha256 hash
  asserted by tests (no new `<script>` added).

---

## 5. Version & test-count lockstep

| Marker | Value |
|---|---|
| `config.js` VERSION | `v0.2.233-alpha` |
| `package.json` | `0.2.233-alpha` ✓ in sync |
| `CURRENT_TEST_STATUS` (continuumData.js) | passing **1574**, files **95** |
| `DEFAULT_TEST_STATUS` (mvpReadiness.js) | passing **1574**, files **95** |
| dist/index.html | carries `v0.2.233-alpha` |
| NEXT_ACTION_STATE.json / MVP_APPROVAL_STATE.json | track `v0.2.233-alpha` |

Continuity docs (todo.md, progress.md, HANDOFF.md, CODE_INDEX.md,
SDK_DEBUG_INDEX.md) all reference `v0.2.233-alpha`.

---

## 6. Checks run

```
npm run test:release
  → Test Files  95 passed (95)
  → Tests      1574 passed (1574)
  → ALL GREEN
  → build OK; regression ALL GREEN
  → handoff status: config v0.2.233-alpha == package 0.2.233-alpha  ✓ in sync
  → bundle: advisory only (rapier chunk over warn limit — tracked, not gated)
[continuum] handoff panel: HANDOFF READY · MVP BLOCKER PENDING
            (USER PLAYTEST + OK) (generated) · green true · pill manual
```

Full unit suite (`npx vitest run`): **1574 passed / 95 files**.
`npm run check`: **ALL GREEN**.

---

## 7. Verdict

✅ **SHIP** — All gates green at commit `f05f4cd`: 95 test files / 1574 tests
passing, `npm run check` ALL GREEN, `npm run test:release` fully green with
version in sync. The slice is status/dashboard/docs-only with no runtime
change, all hard constraints honored, strict semantics preserved, and the
handoff control panel is evidence-gated and non-religious by validator.

**MVP remains BLOCKED on the user's manual playtest + OK** — this is the
intended, unchanged blocker and is correctly reported by the panel (pill
`manual`, `MVP BLOCKER PENDING`). That blocker is for the user, not this slice.

**Do NOT** deploy / publish / push — the main agent handles those.
